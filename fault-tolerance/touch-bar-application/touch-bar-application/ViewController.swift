import Cocoa

extension NSTouchBarItem.Identifier {
    static let taskCount = NSTouchBarItem.Identifier("com.hashcracker.touchbar.taskCount")
    static let componentStatusGroup = NSTouchBarItem.Identifier("com.hashcracker.touchbar.componentStatusGroup")
    static let stopButtonGroup = NSTouchBarItem.Identifier("com.hashcracker.touchbar.stopButtonGroup")
}

struct Component {
    let name: String // Короткое имя для отображения
    let containerName: String // Точное имя контейнера в Docker
    let statusIconName: String // Имя системной иконки SF Symbols
    var isRunning: Bool = false // Текущий статус
    var statusButton: NSButton? // Кнопка-индикатор статуса
    var stopButton: NSButton?   // Кнопка для остановки
}

class ViewController: NSViewController, NSTouchBarDelegate {
    var statusUpdateTimer: Timer?
    let updateInterval: TimeInterval = 2.0 // Интервал проверки статусов (в секундах)

    var taskCountLabel: NSTextField?
    var components: [Component] = [
        Component(name: "Mgr", containerName: "manager-container", statusIconName: "display"),
        Component(name: "W1", containerName: "deploy-worker-app-1", statusIconName: "wrench.and.screwdriver"),
        Component(name: "W2", containerName: "deploy-worker-app-2", statusIconName: "wrench.and.screwdriver"),
        Component(name: "W3", containerName: "deploy-worker-app-3", statusIconName: "wrench.and.screwdriver"),
        Component(name: "DB", containerName: "mongo-node-1", statusIconName: "cylinder.split.1x2"),
        Component(name: "DB", containerName: "mongo-node-2", statusIconName: "cylinder.split.1x2"),
        Component(name: "DB", containerName: "mongo-node-3", statusIconName: "cylinder.split.1x2"),
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
                button.bezelColor = NSColor.systemRed.withAlphaComponent(1)
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
        updateComponentStatuses()
    }

    func fetchTaskCount() {
         guard let url = URL(string: "http://localhost:3000/api/v1/hash/stats") else {
             print("Invalid URL for task count")
             return
         }

         let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
             var countStr = "- "

             if let error = error {
                  print("Error fetching task count: \(error.localizedDescription)")
             } else if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
                 print("HTTP Error fetching task count: \(httpResponse.statusCode)")
             } else if let data = data,
                 let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                 let count = json["activeTaskCount"] as? Int {
                  countStr = "\(count)"
                  print("Fetched active task count: \(count)")
             } else {
                 print("Failed to parse task count JSON or data is missing")
             }

             DispatchQueue.main.async {
                 self?.taskCountLabel?.stringValue = "Tasks: \(countStr)"
             }
         }
         task.resume()
     }

     func updateComponentStatuses() {
         DispatchQueue.global(qos: .background).async { [weak self] in
             guard let self = self else { return }
             var needsUIUpdate = false

             for i in 0..<self.components.count {
                 let containerName = self.components[i].containerName
                 let isNowRunning = self.checkDockerStatus(containerName: containerName)

                 if self.components[i].isRunning != isNowRunning {
                     self.components[i].isRunning = isNowRunning
                     needsUIUpdate = true
                     print("Status changed for \(containerName): \(isNowRunning ? "Running" : "Stopped")")
                 }
             }

             if needsUIUpdate {
                 DispatchQueue.main.async {
                     self.updateStatusIndicators()
                 }
             }
         }
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

     func checkDockerStatus(containerName: String) -> Bool {
         
         let whoami = Process()
         whoami.executableURL = URL(fileURLWithPath: "/usr/bin/whoami")
         let pipeWhoami = Pipe()
         whoami.standardOutput = pipeWhoami
         try? whoami.run()
         whoami.waitUntilExit()
         let user = String(data: pipeWhoami.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
         print("Running as: \(user ?? "unknown")")
         
//         print("Check for: ", containerName)
         let process = Process()
         process.executableURL = URL(fileURLWithPath: "/usr/local/bin/docker")
         process.arguments = ["ps", "--filter", "name=^\(containerName)$", "--filter", "status=running", "--format", "{{.Names}}"]

         let pipe = Pipe()
         process.standardOutput = pipe
//         process.standardError = Pipe()

         do {
             try process.run()
             process.waitUntilExit()

             let data = pipe.fileHandleForReading.readDataToEndOfFile()
             if let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
                 return !output.isEmpty && output == containerName
             }
         } catch {
             print("Error running docker ps for \(containerName): \(error)")
         }
         return false
     }

    @objc func stopComponent(_ sender: NSButton) {
        let index = sender.tag
        guard index >= 0 && index < components.count else { return }
        let containerName = components[index].containerName
        print("UI Action: Attempting to stop container: \(containerName)")


        DispatchQueue.global(qos: .background).async { [weak self] in
            self?.stopDockerContainer(containerName: containerName)

            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                 print("Triggering status update after stop command for \(containerName)")
                self?.updateComponentStatuses()
            }
        }
    }

    func stopDockerContainer(containerName: String) {
         let process = Process()
         process.executableURL = URL(fileURLWithPath: "/usr/local/bin/docker")
         process.arguments = ["stop", containerName]
         process.standardError = Pipe()

         print("Executing: docker stop \(containerName)")
         do {
             try process.run()
             process.waitUntilExit()
             print("Finished: docker stop \(containerName), exit code: \(process.terminationStatus)")
         } catch {
             print("Error running docker stop for \(containerName): \(error)")
         }
     }

     override func viewWillDisappear() {
         statusUpdateTimer?.invalidate()
         statusUpdateTimer = nil
         print("Status timer invalidated")
         super.viewWillDisappear()
     }
}
