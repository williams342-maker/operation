import UIKit
import Capacitor
import Network

class CraftersViewController: CAPBridgeViewController {

    private let refreshControl = UIRefreshControl()
    private var loadingOverlay: UIView?
    private var offlineOverlay: UIView?
    private var progressObservation: NSKeyValueObservation?
    private let networkMonitor = NWPathMonitor()
    private var hasLoadedOnce = false

    private let brandBackground = UIColor(red: 10/255, green: 10/255, blue: 10/255, alpha: 1)
    private let brandAccent = UIColor(red: 232/255, green: 176/255, blue: 75/255, alpha: 1)

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = brandBackground
        webView?.backgroundColor = brandBackground
        webView?.scrollView.backgroundColor = brandBackground
        webView?.isOpaque = false
        webView?.allowsBackForwardNavigationGestures = true
        setupPullToRefresh()
        showLoadingOverlay()
        observeLoadProgress()
        startNetworkMonitor()
    }

    deinit {
        progressObservation?.invalidate()
        networkMonitor.cancel()
    }

    // MARK: - Pull to refresh

    private func setupPullToRefresh() {
        refreshControl.tintColor = UIColor(white: 1, alpha: 0.7)
        refreshControl.addTarget(self, action: #selector(handleRefresh), for: .valueChanged)
        webView?.scrollView.refreshControl = refreshControl
    }

    @objc private func handleRefresh() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        webView?.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            self?.refreshControl.endRefreshing()
        }
    }

    // MARK: - Loading indicator

    private func showLoadingOverlay() {
        guard loadingOverlay == nil else { return }
        let overlay = UIView(frame: view.bounds)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.backgroundColor = brandBackground

        let spinner = UIActivityIndicatorView(style: .large)
        spinner.color = brandAccent
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()
        overlay.addSubview(spinner)

        let label = UILabel()
        label.text = "Crafters Market"
        label.textColor = UIColor(white: 1, alpha: 0.85)
        label.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        label.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(label)

        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: overlay.centerYAnchor, constant: -20),
            label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 16)
        ])

        view.addSubview(overlay)
        loadingOverlay = overlay
    }

    private func hideLoadingOverlay() {
        guard let overlay = loadingOverlay else { return }
        loadingOverlay = nil
        hasLoadedOnce = true
        UIView.animate(withDuration: 0.35, animations: { overlay.alpha = 0 }) { _ in
            overlay.removeFromSuperview()
        }
    }

    private func observeLoadProgress() {
        progressObservation = webView?.observe(\.estimatedProgress, options: [.new]) { [weak self] wv, _ in
            if wv.estimatedProgress >= 0.85 {
                DispatchQueue.main.async { self?.hideLoadingOverlay() }
            }
        }
    }

    // MARK: - Offline handling

    private func startNetworkMonitor() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if path.status == .satisfied {
                    if self.offlineOverlay != nil {
                        self.hideOfflineOverlay()
                        self.reloadSite()
                    }
                } else if !self.hasLoadedOnce {
                    self.showOfflineOverlay()
                }
            }
        }
        networkMonitor.start(queue: DispatchQueue.global(qos: .background))
    }

    private func showOfflineOverlay() {
        guard offlineOverlay == nil else { return }
        hideLoadingOverlay()

        let overlay = UIView(frame: view.bounds)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.backgroundColor = brandBackground

        let title = UILabel()
        title.text = "You're offline"
        title.textColor = .white
        title.font = UIFont.systemFont(ofSize: 24, weight: .bold)
        title.translatesAutoresizingMaskIntoConstraints = false

        let message = UILabel()
        message.text = "Crafters Market needs an internet connection.\nCheck your Wi-Fi or cellular data and try again."
        message.textColor = UIColor(white: 1, alpha: 0.6)
        message.font = UIFont.systemFont(ofSize: 15)
        message.numberOfLines = 0
        message.textAlignment = .center
        message.translatesAutoresizingMaskIntoConstraints = false

        let retryButton = UIButton(type: .system)
        retryButton.setTitle("Try Again", for: .normal)
        retryButton.setTitleColor(.black, for: .normal)
        retryButton.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        retryButton.backgroundColor = brandAccent
        retryButton.layer.cornerRadius = 24
        retryButton.contentEdgeInsets = UIEdgeInsets(top: 14, left: 40, bottom: 14, right: 40)
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)

        overlay.addSubview(title)
        overlay.addSubview(message)
        overlay.addSubview(retryButton)

        NSLayoutConstraint.activate([
            title.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            title.centerYAnchor.constraint(equalTo: overlay.centerYAnchor, constant: -60),
            message.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            message.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 12),
            message.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 32),
            message.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -32),
            retryButton.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            retryButton.topAnchor.constraint(equalTo: message.bottomAnchor, constant: 28)
        ])

        view.addSubview(overlay)
        offlineOverlay = overlay
    }

    private func hideOfflineOverlay() {
        offlineOverlay?.removeFromSuperview()
        offlineOverlay = nil
    }

    @objc private func retryTapped() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        if networkMonitor.currentPath.status == .satisfied {
            hideOfflineOverlay()
            showLoadingOverlay()
            reloadSite()
        } else {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    private func reloadSite() {
        if webView?.url != nil {
            webView?.reload()
        } else if let serverURL = bridge?.config.serverURL {
            webView?.load(URLRequest(url: serverURL))
        }
    }
}
