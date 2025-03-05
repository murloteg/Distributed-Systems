import Cocoa

class ViewController: NSViewController, NSTouchBarDelegate {
    var progressItem: NSCustomTouchBarItem?
    var slider: NSSlider?
    var backgroundView: NSVisualEffectView?

    override func viewDidLoad() {
        super.viewDidLoad()
        self.touchBar = makeTouchBar()
        
    }
    
    override func viewDidAppear() {
        super.viewDidAppear()
        self.view.window?.makeFirstResponder(self)
        self.touchBar = self.makeTouchBar()

        DispatchQueue.main.asyncAfter(deadline: .now()) {
            self.checkStatus()
        }
    }

    override func makeTouchBar() -> NSTouchBar? {
        let touchBar = NSTouchBar()
        touchBar.delegate = self
        touchBar.defaultItemIdentifiers = [.progressBar]
        return touchBar
    }

    func touchBar(_ touchBar: NSTouchBar, makeItemForIdentifier identifier: NSTouchBarItem.Identifier) -> NSTouchBarItem? {
        guard identifier == .progressBar else { return nil }
        progressItem = NSCustomTouchBarItem(identifier: identifier)

        slider = NSSlider(value: 0, minValue: 0, maxValue: 100, target: nil, action: nil)
        slider?.isEnabled = false

        backgroundView = NSVisualEffectView()
        backgroundView?.material = .selection
        backgroundView?.state = .active
        backgroundView?.wantsLayer = true
        backgroundView?.layer?.backgroundColor = NSColor.red.cgColor
        backgroundView?.layer?.cornerRadius = 4
        backgroundView?.addSubview(slider!)

        slider?.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            slider!.leadingAnchor.constraint(equalTo: backgroundView!.leadingAnchor, constant: 4),
            slider!.trailingAnchor.constraint(equalTo: backgroundView!.trailingAnchor, constant: -4),
            slider!.centerYAnchor.constraint(equalTo: backgroundView!.centerYAnchor)
        ])

        progressItem?.view = backgroundView!
        return progressItem
    }

    func checkStatus() {
        guard let url = URL(string: "http://localhost:3000/api/v1/hash/status/first") else { return }
        
        let task = URLSession.shared.dataTask(with: url) { data, response, error in
            guard let data = data, let httpResponse = response as? HTTPURLResponse else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    self.checkStatus()
                }
                return
            }

            if httpResponse.statusCode == 404 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    self.checkStatus()
                }
                return
            }

            do {
                if let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
                   let status = json["status"] as? String {
                    DispatchQueue.main.async {
                        self.updateProgress(for: status)
                    }
                }
            } catch {
                print("Error while JSON parsing")
            }
        }
        task.resume()
    }

    func updateProgress(for status: String) {
        switch status {
        case "IN_PROGRESS":
            print("Waiting result for first task...")
            backgroundView?.layer?.backgroundColor = NSColor.yellow.cgColor
            graduallyIncreaseProgress(to: 80)
            break;
        case "READY":
            print("Successful first task execution")
            backgroundView?.layer?.backgroundColor = NSColor.green.cgColor
            slider?.doubleValue = 100
            break;
        case "ERROR":
            print("Failed first task execution")
            backgroundView?.layer?.backgroundColor = NSColor.red.cgColor
            break;
        default:
            break
        }
    }

    func graduallyIncreaseProgress(to targetValue: Double) {
        guard let slider = slider else { return }
        
        let increment = 2.0
        let interval = 0.2
        
        func animateProgress() {
            if slider.doubleValue < targetValue {
                slider.doubleValue += increment
                DispatchQueue.main.asyncAfter(deadline: .now() + interval) {
                    animateProgress()
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.checkStatus()
        }
        animateProgress()
    }
}

extension NSTouchBarItem.Identifier {
    static let progressBar = NSTouchBarItem.Identifier("progressBar")
}
