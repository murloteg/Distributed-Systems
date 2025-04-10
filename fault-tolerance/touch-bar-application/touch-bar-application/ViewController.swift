import Cocoa

extension NSTouchBarItem.Identifier {
    static let taskCount = NSTouchBarItem.Identifier("com.hashcracker.touchbar.taskCount")
    static let componentStatusGroup = NSTouchBarItem.Identifier("com.hashcracker.touchbar.componentStatusGroup")
    static let stopButtonGroup = NSTouchBarItem.Identifier("com.hashcracker.touchbar.stopButtonGroup")
}

struct Component {
    let name: String
    let containerName: String
    let statusIconName: String
    var isRunning: Bool = false
    var statusButton: NSButton?
    var stopButton: NSButton?
}

class ViewController: NSViewController, NSTouchBarDelegate {
    var statusUpdateTimer: Timer?
    let updateInterval: TimeInterval = 2.0
    let proxyBaseUrl = "http://localhost:17871"

    var taskCountLabel: NSTextField?
    var components: [Component] = [
        Component(name: "Mgr", containerName: "manager-container", statusIconName: "display"),
        Component(name: "W1", containerName: "deploy-worker-app-1", statusIconName: "wrench.and.screwdriver"),
        Component(name: "W2", containerName: "deploy-worker-app-2", statusIconName: "wrench.and.screwdriver"),
        Component(name: "W3", containerName: "deploy-worker-app-3", statusIconName: "wrench.and.screwdriver"),
        Component(name: "DB1", containerName: "mongo-node-1", statusIconName: "cylinder.split.1x2"),
        Component(name: "DB2", containerName: "mongo-node-2", statusIconName: "cylinder.split.1x2"),
        Component(name: "DB3", containerName: "mongo-node-3", statusIconName: "cylinder.split.1x2"),
        Component(name: "RMQ", containerName: "rabbitmq", statusIconName: "hare")
    ]

    override func viewDidLoad() {
        super.viewDidLoad()
        self.view.frame = NSRect(x: 0, y: 0, width: 400, height: 200)
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        self.view.window?.makeFirstResponder(self)
        self.touchBar = makeTouchBar()
        startStatusUpdates()
    }

    override func makeTouchBar() -> NSTouchBar? {
        let touchBar = NSTouchBar()
        touchBar.delegate = self
        touchBar.defaultItemIdentifiers = [
            .taskCount,
            .flexibleSpace,
            .componentStatusGroup,
            .flexibleSpace,
            .stopButtonGroup,
        ]
        return touchBar
    }

    func touchBar(_ touchBar: NSTouchBar, makeItemForIdentifier identifier: NSTouchBarItem.Identifier) -> NSTouchBarItem? {
        switch identifier {
        case .taskCount:
            let item = NSCustomTouchBarItem(identifier: identifier)
            taskCountLabel = NSTextField(labelWithString: "Tasks: -")
            taskCountLabel?.font = NSFont.monospacedDigitSystemFont(ofSize: 15, weight: .regular)
            item.view = taskCountLabel!
            return item

        case .componentStatusGroup:
            let item = NSCustomTouchBarItem(identifier: identifier)
            let stackView = NSStackView()
            stackView.orientation = .horizontal
            stackView.spacing = 8

            for i in 0..<components.count {
                let image = NSImage(systemSymbolName: components[i].statusIconName, accessibilityDescription: components[i].name) ?? NSImage()
                let button = NSButton(image: image, target: nil, action: nil)
                button.bezelStyle = .regularSquare
                button.isBordered = false
                button.toolTip = components[i].containerName
                setStatusIndicatorColor(button: button, isRunning: components[i].isRunning)
                components[i].statusButton = button
                stackView.addArrangedSubview(button)
            }
            item.view = stackView
            item.visibilityPriority = .high
            return item

        case .stopButtonGroup:
            let item = NSCustomTouchBarItem(identifier: identifier)
            let stackView = NSStackView()
            stackView.orientation = .horizontal
            stackView.spacing = 5

            for i in 0..<components.count {
                let button = NSButton(title: "Stop \(components[i].name)", target: self, action: #selector(stopComponent(_:)))
                button.tag = i
                button.bezelStyle = .rounded
                button.bezelColor = NSColor.systemRed.withAlphaComponent(0.6)
                components[i].stopButton = button
                stackView.addArrangedSubview(button)
            }
            item.view = stackView
            item.visibilityPriority = .low
            return item

        default:
            return nil
        }
    }

    func startStatusUpdates() {
        statusUpdateTimer?.invalidate()
        updateAllStatuses()
        statusUpdateTimer = Timer.scheduledTimer(withTimeInterval: updateInterval, repeats: true) { [weak self] _ in
            self?.updateAllStatuses()
        }
         RunLoop.main.add(statusUpdateTimer!, forMode: .common)
    }

    func updateAllStatuses() {
        fetchTaskCount()
        updateComponentStatusesViaProxy()
    }

    func fetchTaskCount() {
         guard let url = URL(string: "http://localhost:3000/api/v1/hash/stats") else { return }
         let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
             var countStr = "- "
             if let error = error { print("Error fetching task count: \(error.localizedDescription)") }
             else if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) { print("HTTP Error fetching task count: \(httpResponse.statusCode)") }
             else if let data = data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let count = json["activeTaskCount"] as? Int {
                 countStr = "\(count)"
                 print("Fetched active task count: \(count)")
             } else { print("Failed to parse task count JSON or data is missing") }
             DispatchQueue.main.async { self?.taskCountLabel?.stringValue = "Tasks: \(countStr)" }
         }
         task.resume()
     }

     func updateComponentStatusesViaProxy() {
         guard let url = URL(string: "\(proxyBaseUrl)/api/v1/status-check") else {
             print("Invalid URL for proxy status check")
             return
         }

         var request = URLRequest(url: url)
         request.httpMethod = "GET"
         request.timeoutInterval = updateInterval - 0.5

         let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
             guard let self = self else { return }

             var needsUIUpdate = false
             var receivedStatuses: [String: String] = [:]

             if let error = error {
                 print("Error fetching proxy statuses: \(error.localizedDescription)")
                 for i in 0..<self.components.count {
                     if self.components[i].isRunning {
                         self.components[i].isRunning = false
                         needsUIUpdate = true
                     }
                 }
             } else if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
                 print("HTTP Error fetching proxy statuses: \(httpResponse.statusCode)")
                 for i in 0..<self.components.count {
                     if self.components[i].isRunning {
                         self.components[i].isRunning = false
                         needsUIUpdate = true
                     }
                 }
             } else if let data = data {
                 if let statuses = try? JSONDecoder().decode([String: String].self, from: data) {
                     print("Received statuses from proxy: \(statuses.count) items")
                     receivedStatuses = statuses
                     for i in 0..<self.components.count {
                         let containerName = self.components[i].containerName
                         let currentProxyStatus = receivedStatuses[containerName]?.lowercased() ?? "stopped"
                         let isNowRunning = (currentProxyStatus == "running")

                         if self.components[i].isRunning != isNowRunning {
                             self.components[i].isRunning = isNowRunning
                             needsUIUpdate = true
                             print("Status changed for \(containerName): \(isNowRunning ? "Running" : "Stopped")")
                         }
                     }
                 } else {
                     print("Failed to decode JSON statuses from proxy")
                     for i in 0..<self.components.count {
                         if self.components[i].isRunning {
                             self.components[i].isRunning = false
                             needsUIUpdate = true
                         }
                     }
                 }
             }

             if needsUIUpdate {
                 DispatchQueue.main.async {
                     self.updateStatusIndicators()
                 }
             }
         }
         task.resume()
     }

     func updateStatusIndicators() {
         print("Updating status indicators UI")
         for i in 0..<components.count {
             if let button = components[i].statusButton {
                 setStatusIndicatorColor(button: button, isRunning: components[i].isRunning)
             }
             components[i].stopButton?.isEnabled = components[i].isRunning
         }
     }

     func setStatusIndicatorColor(button: NSButton, isRunning: Bool) {
         button.contentTintColor = isRunning ? .systemGreen : .systemRed
     }

    @objc func stopComponent(_ sender: NSButton) {
        let index = sender.tag
        guard index >= 0 && index < components.count else { return }
        let containerName = components[index].containerName
        print("UI Action: Attempting to stop container via proxy: \(containerName)")

        sender.isEnabled = false

        DispatchQueue.global(qos: .background).async { [weak self] in
            self?.stopContainerViaProxy(containerName: containerName) { success in
                 DispatchQueue.main.async {
                     sender.isEnabled = true
                     if success {
                         print("Stop command successful for \(containerName), triggering status update.")
                          DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                              self?.updateComponentStatusesViaProxy()
                          }
                     } else {
                         print("Stop command failed for \(containerName).")
                     }
                 }
            }
        }
    }

    func stopContainerViaProxy(containerName: String, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: "\(proxyBaseUrl)/api/v1/stop-container") else {
             print("Invalid URL for proxy stop-container")
             completion(false)
             return
         }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload = ["name": containerName]
        guard let httpBody = try? JSONEncoder().encode(payload) else {
             print("Failed to encode JSON payload for stop command")
             completion(false)
             return
         }
        request.httpBody = httpBody

        print("Executing POST to stop \(containerName) via proxy...")
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            var success = false
            if let error = error {
                 print("Error sending stop command via proxy: \(error.localizedDescription)")
             } else if let httpResponse = response as? HTTPURLResponse {
                 if (200...299).contains(httpResponse.statusCode) {
                     if let data = data, let json = try? JSONDecoder().decode([String: String].self, from: data) {
                         print("Proxy response for stop \(containerName): \(json)")
                         success = (json["status"]?.lowercased() != "running")
                     } else {
                         print("Stop command sent, but proxy response parsing failed. Assuming success based on HTTP code.")
                         success = true
                     }
                 } else {
                     print("HTTP Error from proxy stop command: \(httpResponse.statusCode)")
                 }
             }
             completion(success)
         }
         task.resume()
    }

     override func viewWillDisappear() {
         statusUpdateTimer?.invalidate()
         statusUpdateTimer = nil
         print("Status timer invalidated")
         super.viewWillDisappear()
     }
}
