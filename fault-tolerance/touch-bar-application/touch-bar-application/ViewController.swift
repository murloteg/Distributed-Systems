import Cocoa

extension NSTouchBarItem.Identifier {
    static let taskCount = NSTouchBarItem.Identifier("com.hashcracker.touchbar.taskCount")
    static let lastTaskProgress = NSTouchBarItem.Identifier("com.hashcracker.touchbar.lastTaskProgress")
    static let componentStatusGroup = NSTouchBarItem.Identifier("com.hashcracker.touchbar.componentStatusGroup")
}

struct TaskStatusResponse: Decodable {
    let status: String
    // let data: [String]?
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
    // Таймеры и интервалы
    var statusUpdateTimer: Timer?
    let updateInterval: TimeInterval = 2.0
    var progressAnimationTimer: Timer?
    var progressAnimationStartTime: Date?
    let progressAnimationDuration: TimeInterval = 10.0
    let progressTargetValue: Double = 1

    // URL Endpoints
    let proxyBaseUrl = "http://127.0.0.1:17871"
    let lastTaskStatusUrl = "http://127.0.0.1:3000/api/v1/hash/status/last"
    let taskCountUrl = "http://127.0.0.1:3000/api/v1/hash/stats"

    // UI Элементы Touch Bar
    var taskCountLabel: NSTextField?
    var lastTaskContainerView: NSView?
    var lastTaskSlider: NSSlider?

    // Данные и состояние
    var lastTaskStatus: String?
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
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        self.view.window?.makeFirstResponder(self)
        self.touchBar = makeTouchBar()
        startStatusUpdates()
    }

    override func viewWillDisappear() {
        statusUpdateTimer?.invalidate()
        statusUpdateTimer = nil
        progressAnimationTimer?.invalidate()
        progressAnimationTimer = nil
        print("Status and Animation timers invalidated")
        super.viewWillDisappear()
    }

    override func makeTouchBar() -> NSTouchBar? {
        let touchBar = NSTouchBar()
        touchBar.delegate = self
        touchBar.defaultItemIdentifiers = [
            .taskCount,
            .fixedSpaceSmall,
            .lastTaskProgress,
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

        case .lastTaskProgress:
            let item = NSCustomTouchBarItem(identifier: identifier)
            let containerView = NSView()
            containerView.translatesAutoresizingMaskIntoConstraints = false
            containerView.wantsLayer = true
            containerView.layer?.cornerRadius = 4

            let slider = NSSlider(value: 0, minValue: 0, maxValue: 1, target: nil, action: nil)
            slider.translatesAutoresizingMaskIntoConstraints = false
            slider.sliderType = .linear
            slider.isEnabled = false

            if #available(macOS 10.12.2, *) {
                slider.trackFillColor = NSColor.lightGray.withAlphaComponent(0.8)
            }
            containerView.addSubview(slider)

            NSLayoutConstraint.activate([
                containerView.widthAnchor.constraint(equalToConstant: 160),
                containerView.heightAnchor.constraint(equalToConstant: 18),

                slider.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 2),
                slider.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -2),
                slider.centerYAnchor.constraint(equalTo: containerView.centerYAnchor)
            ])

            containerView.layer?.backgroundColor = NSColor.darkGray.withAlphaComponent(0.6).cgColor
            slider.doubleValue = 0.0

            self.lastTaskContainerView = containerView
            self.lastTaskSlider = slider
            item.view = containerView

            return item

        case .componentStatusGroup:
            let item = NSCustomTouchBarItem(identifier: identifier)
            let stackView = NSStackView()
            stackView.orientation = .horizontal
            stackView.spacing = 8

            // Создаем кнопки-иконки для каждого компонента
            for i in 0..<components.count {
                let component = components[i]
                let image = NSImage(systemSymbolName: component.statusIconName, accessibilityDescription: component.name) ?? NSImage()
                image.isTemplate = true

                let button = NSButton(image: image, target: self, action: #selector(stopComponent(_:)))
                button.tag = i
                button.bezelStyle = .regularSquare
                button.isBordered = false
                button.toolTip = "Stop \(component.containerName)"
                button.imageScaling = .scaleProportionallyDown

                setStatusIndicatorColor(button: button, isRunning: component.isRunning)
                button.isEnabled = component.isRunning

                component.statusButton = button
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
        progressAnimationTimer?.invalidate()
        updateAllStatuses()
        statusUpdateTimer = Timer.scheduledTimer(withTimeInterval: updateInterval, repeats: true) { [weak self] _ in
            self?.updateAllStatuses()
        }
        RunLoop.main.add(statusUpdateTimer!, forMode: .common)
    }

    // Вызывает все функции обновления статусов
    func updateAllStatuses() {
        fetchTaskCount()
        updateComponentStatusesViaProxy()
        fetchLastTaskStatus()
    }

    func fetchTaskCount() {
         guard let url = URL(string: taskCountUrl) else {
            print("Invalid URL for task count: \(taskCountUrl)")
            return
         }
         let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
             var countStr = "- "
             if let error = error { print("Error fetching task count: \(error.localizedDescription)") }
             else if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) { print("HTTP Error fetching task count: \(httpResponse.statusCode)") }
             else if let data = data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let count = json["activeTaskCount"] as? Int {
                 countStr = "\(count)"
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
                    // Обновляем статус каждого компонента
                     for i in 0..<self.components.count {
                         let component = self.components[i]
                         let currentProxyStatus = statuses[component.containerName]?.lowercased() ?? "stopped"
                         let isNowRunning = (currentProxyStatus == "running")

                         if component.isRunning != isNowRunning {
                             self.components[i].isRunning = isNowRunning
                             needsUIUpdate = true
                             print("Status changed for \(component.containerName): \(isNowRunning ? "Running" : "Stopped")")
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

    func fetchLastTaskStatus() {
        guard let url = URL(string: lastTaskStatusUrl) else {
            print("Invalid URL for last task status: \(lastTaskStatusUrl)")
            DispatchQueue.main.async { [weak self] in
                self?.updateLastTaskProgressUI(newStatus: "ERROR", errorOccurred: true)
            }
            return
        }

        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            var finalStatus = "ERROR"
            var fetchError = true

            if let error = error {
                print("Error fetching last task status: \(error.localizedDescription)")
            } else if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
                print("HTTP Error fetching last task status: \(httpResponse.statusCode)")
            } else if let data = data {
                let decoder = JSONDecoder()
                decoder.userInfo[CodingUserInfoKey(rawValue: "failOnUnknownProperties")!] = false
                if let decodedResponse = try? decoder.decode(TaskStatusResponse.self, from: data) {
                    finalStatus = decodedResponse.status.uppercased()
                    fetchError = false
                } else {
                    print("Failed to parse last task status JSON")
                }
            }

            DispatchQueue.main.async {
                self?.updateLastTaskProgressUI(newStatus: finalStatus, errorOccurred: fetchError)
            }
        }
        task.resume()
    }

    func updateLastTaskProgressUI(newStatus: String, errorOccurred: Bool = false) {
        guard let container = self.lastTaskContainerView,
              let slider = self.lastTaskSlider else { return }

        let previousStatus = self.lastTaskStatus
        self.lastTaskStatus = newStatus

        if previousStatus == "IN_PROGRESS" && newStatus != "IN_PROGRESS" {
            progressAnimationTimer?.invalidate()
            progressAnimationTimer = nil
            progressAnimationStartTime = nil
            print("Progress animation stopped (status change)")
        }

        var targetValue: Double = 0.0
        var targetBackgroundColor: NSColor = .darkGray.withAlphaComponent(0.6)

        switch newStatus {
        case "PENDING":
            targetValue = 0.0
            targetBackgroundColor = .darkGray.withAlphaComponent(0.6)
        case "IN_PROGRESS":
            targetValue = slider.doubleValue
            targetBackgroundColor = .systemYellow.withAlphaComponent(0.6)
            if progressAnimationTimer == nil {
                 print("Starting progress animation...")
                 progressAnimationStartTime = Date()
                 if previousStatus != "IN_PROGRESS" { slider.doubleValue = 0.0 }
                 progressAnimationTimer = Timer.scheduledTimer(timeInterval: 0.1, target: self, selector: #selector(animateProgress(_:)), userInfo: nil, repeats: true)
                 RunLoop.main.add(progressAnimationTimer!, forMode: .common)
             }
        case "READY":
            targetValue = 1.0
            targetBackgroundColor = .systemGreen.withAlphaComponent(0.6)
        case "ERROR":
            targetValue = 1.0
            targetBackgroundColor = .systemRed.withAlphaComponent(0.6)
        default:
            targetValue = 0.0
            targetBackgroundColor = .darkGray.withAlphaComponent(0.6)
            print("Unknown task status received: \(newStatus)")
        }

        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.3
            context.allowsImplicitAnimation = true
            container.layer?.backgroundColor = targetBackgroundColor.cgColor
        }, completionHandler: nil)

        if newStatus != "IN_PROGRESS" {
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = 0.2
                context.allowsImplicitAnimation = true
                slider.doubleValue = targetValue
            }, completionHandler: nil)
        }
    }

    @objc func animateProgress(_ timer: Timer) {
        guard let slider = self.lastTaskSlider,
              let startTime = self.progressAnimationStartTime,
              self.lastTaskStatus == "IN_PROGRESS"
        else {
            timer.invalidate(); progressAnimationTimer = nil; progressAnimationStartTime = nil
            print("Progress animation stopped unexpectedly.")
            return
        }

        let elapsedTime = Date().timeIntervalSince(startTime)
        let animationProgress = min(elapsedTime / progressAnimationDuration, 1.0)
        let currentValue = animationProgress * progressTargetValue

        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.1
            context.allowsImplicitAnimation = true
            slider.doubleValue = currentValue
        }, completionHandler: nil)

        if elapsedTime >= progressAnimationDuration {
            timer.invalidate(); progressAnimationTimer = nil; progressAnimationStartTime = nil
            NSAnimationContext.runAnimationGroup({ context in
                 context.duration = 0.1
                 context.allowsImplicitAnimation = true
                 slider.doubleValue = progressTargetValue
             }, completionHandler: nil)
            print("Progress animation finished.")
        }
    }

    func updateStatusIndicators() {
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
                      guard let strongSelf = self else { return }
                     if success {
                         print("Stop command potentially successful for \(containerName). Updating UI.")
                         if let button = strongSelf.components[index].statusButton {
                             strongSelf.components[index].isRunning = false
                             strongSelf.setStatusIndicatorColor(button: button, isRunning: false)
                             button.isEnabled = false
                         }
                     } else {
                         print("Stop command failed or status did not change for \(containerName). Reverting UI.")
                         if let button = strongSelf.components[index].statusButton {
                             button.isEnabled = strongSelf.components[index].isRunning
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
             } else {
                 print("Stop command sent, but no valid response or error received.")
             }
             completion(success)
         }
         task.resume()
    }
}
