import Cocoa

extension NSTouchBarItem.Identifier {
    static let taskCount = NSTouchBarItem.Identifier("com.hashcracker.touchbar.taskCount")
    static let componentStatusGroup = NSTouchBarItem.Identifier("com.hashcracker.touchbar.componentStatusGroup")
}

class Component {
    let name: String
    let containerName: String
    let statusIconName: String
    var isRunning: Bool
    var statusButton: NSButton?

    init(name: String, containerName: String, statusIconName: String, isRunning: Bool = false) {
        self.name = name
        self.containerName = containerName
        self.statusIconName = statusIconName
        self.isRunning = isRunning
    }
}

class ViewController: NSViewController, NSTouchBarDelegate {
    var statusUpdateTimer: Timer?
    let updateInterval: TimeInterval = 2.0
    let proxyBaseUrl = "http://127.0.0.1:17871"

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
                image.isTemplate = true

                let button = NSButton(image: image, target: self, action: #selector(stopComponent(_:)))
                button.tag = i
                button.bezelStyle = .regularSquare
                button.isBordered = false
                button.toolTip = "Stop \(components[i].containerName)"
                button.imageScaling = .scaleProportionallyDown

                setStatusIndicatorColor(button: button, isRunning: components[i].isRunning)
                button.isEnabled = components[i].isRunning

                components[i].statusButton = button
                stackView.addArrangedSubview(button)
            }
            item.view = stackView
            item.visibilityPriority = .high
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
         guard let url = URL(string: "http://127.0.0.1:3000/api/v1/hash/stats") else {
            print("Invalid URL for task count")
            return
         }
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
             var hadError = false

             if let error = error {
                 print("Error fetching proxy statuses: \(error.localizedDescription)")
                 hadError = true
             } else if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
                 print("HTTP Error fetching proxy statuses: \(httpResponse.statusCode)")
                 hadError = true
             }

             if hadError {
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
                     print("Failed to decode JSON statuses from proxy. Assuming all stopped.")
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
                 button.isEnabled = components[i].isRunning
             }
         }
     }

     func setStatusIndicatorColor(button: NSButton, isRunning: Bool) {
         button.contentTintColor = isRunning ? .systemGreen : .systemRed
     }

    @objc func stopComponent(_ sender: NSButton) {
        let index = sender.tag
        guard index >= 0 && index < components.count else {
            print("Error: Invalid button tag \(index)")
            return
        }

        let component = components[index]
        let containerName = component.containerName
        print("UI Action: Attempting to stop container via proxy: \(containerName)")

        sender.isEnabled = false
        sender.contentTintColor = .systemGray

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.stopContainerViaProxy(containerName: containerName) { success in
                 DispatchQueue.main.async {
                     if success {
                         print("Stop command potentially successful for \(containerName). Triggering status update.")
                         if let strongSelf = self {
                            strongSelf.components[index].isRunning = false
                            strongSelf.updateStatusIndicators()
                         }
                     } else {
                         print("Stop command failed or status did not change for \(containerName). Re-enabling button.")
                         sender.isEnabled = true
                          if let strongSelf = self, let button = strongSelf.components[index].statusButton {
                             strongSelf.setStatusIndicatorColor(button: button, isRunning: strongSelf.components[index].isRunning)
                         }
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
                     print("Proxy accepted stop command for \(containerName) with status \(httpResponse.statusCode)")
                     success = true
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
