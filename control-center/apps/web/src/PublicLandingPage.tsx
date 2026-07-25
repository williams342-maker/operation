import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  CloudUpload,
  Code2,
  Gauge,
  GitBranch,
  LockKeyhole,
  Menu,
  MonitorCheck,
  Play,
  RefreshCcw,
  Rocket,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import "./publicLanding.css";

type MarketingEvent =
  | "header_get_started"
  | "hero_start_free"
  | "see_how_it_works"
  | "ai_builder_cta"
  | "seo_optimizer_cta"
  | "sign_in"
  | "super_user_access";

function trackMarketingEvent(name: MarketingEvent) {
  window.dispatchEvent(new CustomEvent("opsworkbench:analytics", { detail: { name } }));
}

const adminLoginPath = "/login?returnTo=%2Fadmin";

function Brand() {
  return (
    <a className="marketing-brand" href="/" aria-label="OpsWorkbench home">
      <span className="marketing-brand__mark" aria-hidden="true"><span>OW</span></span>
      <span className="marketing-brand__name">Ops<span>Work</span><strong>Bench</strong></span>
    </a>
  );
}

function DashboardPreview() {
  const activity = [42, 38, 47, 35, 44, 40, 51, 43, 49, 62, 57, 73, 55, 39, 48, 74, 77, 96, 82, 105];
  return (
    <div className="dashboard-preview" aria-label="Example OpsWorkbench dashboard using sample data">
      <div className="preview-sidebar" aria-hidden="true">
        <div className="preview-mini-brand"><Activity /> <span>OpsWorkbench</span></div>
        {[
          ["Overview", Gauge], ["Projects", Code2], ["Servers", MonitorCheck],
          ["Deployments", Rocket], ["Monitoring", Activity], ["AI Website Builder", Bot],
          ["SEO Optimizer", SearchCheck],
        ].map(([label, Icon], index) => (
          <div className={`preview-nav ${index === 0 ? "is-active" : ""}`} key={String(label)}>
            <Icon className="preview-nav__icon" /><span>{String(label)}</span>
            {(label === "AI Website Builder" || label === "SEO Optimizer") && <b>NEW</b>}
          </div>
        ))}
      </div>
      <div className="preview-content">
        <div className="preview-top"><strong>Overview</strong><span>Last 30 days</span></div>
        <div className="preview-stats">
          {[["Projects", "12", "All active"], ["Servers", "18", "Healthy"], ["Deployments", "42", "This month"], ["Success rate", "99.9%", "Last 30 days"]].map(([label, value, detail]) => (
            <div className="preview-stat" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
          ))}
        </div>
        <div className="preview-grid">
          <div className="preview-chart-card">
            <div className="preview-card-title">Deployment activity <span>All projects</span></div>
            <div className="preview-chart" aria-hidden="true">
              {activity.map((height, index) => <i key={index} style={{ height: `${height / 1.2}%` }} />)}
            </div>
            <div className="preview-axis"><span>May 6</span><span>May 20</span><span>Jun 3</span></div>
          </div>
          <div className="preview-health">
            <div className="preview-card-title">System health</div>
            {[["CPU Usage", "24%"], ["Memory Usage", "41%"], ["Disk Usage", "38%"], ["Network", "Healthy"]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}
            <strong><Check /> All systems operational</strong>
          </div>
          <div className="preview-deployments">
            <div className="preview-card-title">Recent deployments</div>
            {["Sample Store", "Docs Portal", "Portfolio Site"].map((name, index) => <div key={name}><span><i>{String.fromCharCode(65 + index)}</i>{name}</span><small>{index * 18 + 2}m ago</small><b>Success</b></div>)}
          </div>
          <div className="preview-alerts">
            <div className="preview-card-title">Active alerts</div>
            <div><i className="warning" /> Certificate renewal due <small>3h</small></div>
            <div><i /> Backup completed <small>5h</small></div>
            <a href="#operations">View operations</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PublicLandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = (restoreFocus = true) => {
    setMenuOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    document.title = "OpsWorkbench | Deploy, Build, Monitor and Optimize Websites";
    document.documentElement.classList.add("marketing-page-active");
    return () => document.documentElement.classList.remove("marketing-page-active");
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeMenu(); return; }
      if (event.key !== "Tab" || !menuRef.current) return;
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", handleKeyDown); };
  }, [menuOpen]);

  const nav = [
    ["Features", "#features"], ["How It Works", "#how-it-works"], ["AI Website Builder", "#ai-builder"],
    ["SEO Optimizer", "#seo"], ["Pricing", "#pricing"], ["Resources", "#operations"], ["About", "#about"],
  ];
  const featureStrip = [
    [Rocket, "One-Click Deployments", "Deploy code to any server in seconds with zero command line."],
    [ShieldCheck, "Monitor & Protect", "Real-time monitoring, alerts, backups, and security to keep you covered."],
    [Sparkles, "AI Website Builder", "Create responsive websites in minutes with AI—no code required."],
    [SearchCheck, "SEO Optimizer", "Improve rankings, drive traffic, and grow with intelligent SEO tools."],
    [Zap, "Built-In Automation", "Schedule tasks, updates, maintenance, and recurring workflows."],
    [LockKeyhole, "Secure by Design", "Strong authentication, role controls, approval gates, and encrypted secrets."],
  ];
  const steps = [
    [GitBranch, "Connect", "Connect your Git repository and servers securely."],
    [CloudUpload, "Deploy", "Choose your project and deploy with one click."],
    [MonitorCheck, "Monitor", "Watch real-time metrics, health checks, and alerts."],
    [ShieldCheck, "Optimize & Maintain", "Use automation and AI to keep your website fast, secure, updated, and ranking higher."],
  ];

  return (
    <div className="marketing-page">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="marketing-header">
        <div className="marketing-container marketing-header__inner">
          <Brand />
          <nav className="desktop-nav" aria-label="Public navigation">
            {nav.map(([label, href]) => <a key={label} href={href}>{label}{label === "Features" || label === "Resources" ? <ChevronDown aria-hidden="true" /> : null}</a>)}
          </nav>
          <div className="desktop-actions">
            <a className="marketing-button marketing-button--outline" href={adminLoginPath} onClick={() => trackMarketingEvent("sign_in")}>Sign In</a>
            <a className="marketing-button marketing-button--gradient" href={adminLoginPath} onClick={() => trackMarketingEvent("header_get_started")}>Get Started Free</a>
          </div>
          <button ref={triggerRef} className="mobile-menu-trigger" type="button" aria-expanded={menuOpen} aria-controls="marketing-mobile-menu" aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)}>{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </header>
      {menuOpen && <button className="mobile-menu-scrim" type="button" aria-label="Close menu" onClick={() => closeMenu()} />}
      <div ref={menuRef} id="marketing-mobile-menu" className={`mobile-menu ${menuOpen ? "is-open" : ""}`} aria-hidden={!menuOpen}>
        <Brand />
        <nav aria-label="Mobile public navigation">{nav.map(([label, href]) => <a key={label} href={href} onClick={() => closeMenu(false)}>{label}</a>)}</nav>
        <a className="marketing-button marketing-button--outline" href={adminLoginPath} onClick={() => trackMarketingEvent("sign_in")}>Sign In</a>
        <a className="marketing-button marketing-button--gradient" href={adminLoginPath} onClick={() => trackMarketingEvent("header_get_started")}>Get Started Free</a>
      </div>

      <main id="main-content">
        <section className="marketing-hero" aria-labelledby="hero-title">
          <div className="hero-grid-pattern" aria-hidden="true" />
          <div className="marketing-container hero-layout">
            <div className="hero-copy">
              <p className="eyebrow">DEPLOY <i /> MONITOR <i /> PROTECT <i /> BUILD <i /> GROW</p>
              <h1 id="hero-title">Deploy with confidence.<br />Build with <span className="aqua-text">AI.</span><br /><span className="blue-text">Grow</span> with smarter <span className="green-text">SEO.</span></h1>
              <p className="hero-summary">OpsWorkbench is your all-in-one platform to deploy, monitor, manage, and optimize your websites and servers—all from one powerful dashboard.</p>
              <div className="hero-actions">
                <a className="marketing-button marketing-button--gradient marketing-button--large" href={adminLoginPath} onClick={() => trackMarketingEvent("hero_start_free")}>Start Free – 100 Credits <ArrowRight /></a>
                <a className="marketing-button marketing-button--glass marketing-button--large" href="#how-it-works" onClick={() => trackMarketingEvent("see_how_it_works")}>See How It Works <Play /></a>
              </div>
              <ul className="trust-list" aria-label="Product assurances">
                <li><ShieldCheck /> No Credit Card Required</li><li><LockKeyhole /> Secure by Design</li><li><RefreshCcw /> Rollback in Seconds</li><li><Activity /> Real-Time Monitoring</li>
              </ul>
            </div>
            <DashboardPreview />
          </div>
        </section>

        <section id="features" className="feature-strip" aria-labelledby="features-title">
          <h2 id="features-title" className="sr-only">Core capabilities</h2>
          <div className="marketing-container feature-strip__grid">
            {featureStrip.map(([Icon, title, copy]) => <article key={String(title)}><Icon /><h3>{String(title)}</h3><p>{String(copy)}</p></article>)}
          </div>
        </section>

        <section id="how-it-works" className="light-section workflow-section" aria-labelledby="workflow-title">
          <div className="marketing-container">
            <div className="section-heading"><span /><div><h2 id="workflow-title">How It Works</h2><p>From code to production in four simple steps.</p></div><span /></div>
            <div className="workflow-grid">
              {steps.map(([Icon, title, copy], index) => <article key={String(title)}><div className="workflow-icon"><Icon /></div><div><h3><b>{index + 1}</b>{String(title)}</h3><p>{String(copy)}</p></div>{index < steps.length - 1 && <ArrowRight className="workflow-arrow" aria-hidden="true" />}</article>)}
            </div>
          </div>
        </section>

        <section id="ai-builder" className="product-section product-section--dark" aria-labelledby="ai-title">
          <div className="marketing-container product-layout">
            <div><p className="section-kicker"><Bot /> AI WEBSITE BUILDER</p><h2 id="ai-title">From a prompt to a polished, deployable website.</h2><p>Build responsive pages with reusable components, brand controls, and a preview-first workflow. Use credits only when you create, then deploy through the same trusted operations platform.</p><ul className="check-grid">{["Prompt-based generation", "Responsive page creation", "Reusable components", "Brand and color controls", "Preview before deployment", "OpsWorkbench deployment", "Credit-based usage"].map(item => <li key={item}><Check />{item}</li>)}</ul><a className="marketing-button marketing-button--gradient" href={adminLoginPath} onClick={() => trackMarketingEvent("ai_builder_cta")}>Build My Website <ArrowRight /></a></div>
            <div className="product-visual builder-visual" aria-label="Illustration of an AI website creation workflow"><div className="prompt-line"><Sparkles /><span>Build a modern service website…</span><ArrowRight /></div><div className="wireframe"><i /><i /><i /><b /></div><div className="builder-status"><Check /> Responsive preview ready</div></div>
          </div>
        </section>

        <section id="seo" className="product-section product-section--light" aria-labelledby="seo-title">
          <div className="marketing-container product-layout product-layout--reverse">
            <div className="product-visual seo-visual" aria-label="Example website optimization score"><div className="score-ring"><strong>92</strong><span>Site score</span></div><div className="seo-bars">{[["Technical SEO", 94], ["Content", 86], ["Performance", 91]].map(([label, score]) => <div key={String(label)}><span>{label}<b>{score}%</b></span><i><b style={{ width: `${score}%` }} /></i></div>)}</div></div>
            <div><p className="section-kicker"><SearchCheck /> SEO OPTIMIZER</p><h2 id="seo-title">Find what holds your website back—and fix it safely.</h2><p>Audit technical SEO, metadata, content, sitemaps, indexing, and performance. Material changes stay behind an explicit approval gate.</p><ul className="check-grid">{["Site and technical audit", "Metadata recommendations", "Keyword suggestions", "Content optimization", "Sitemap and indexing checks", "Performance tracking", "Approval before material changes"].map(item => <li key={item}><Check />{item}</li>)}</ul><a className="marketing-button marketing-button--gradient" href={adminLoginPath} onClick={() => trackMarketingEvent("seo_optimizer_cta")}>Analyze My Website <ArrowRight /></a></div>
          </div>
        </section>

        <section id="operations" className="operations-section" aria-labelledby="operations-title">
          <div className="marketing-container"><div className="section-copy-centered"><p className="section-kicker"><Gauge /> DEPLOYMENT & OPERATIONS</p><h2 id="operations-title">Everything between a commit and a healthy website.</h2><p>Connect Git, promote through staging and production, validate health, preserve rollback checkpoints, automate backups, monitor servers, and keep every approval in an audit trail.</p></div><div className="operations-grid">{[[GitBranch, "Git-connected deployments"], [MonitorCheck, "Health checks & monitoring"], [RefreshCcw, "Rollback & backups"], [ShieldCheck, "Approval gates & audit history"]].map(([Icon, title]) => <div key={String(title)}><Icon /><span>{String(title)}</span></div>)}</div></div>
        </section>

        <section id="pricing" className="final-cta" aria-labelledby="final-cta-title"><div className="marketing-container"><div><p>READY WHEN YOU ARE</p><h2 id="final-cta-title">Build it. Deploy it. Keep it healthy.</h2></div><div><a className="marketing-button marketing-button--gradient marketing-button--large" href={adminLoginPath} onClick={() => trackMarketingEvent("hero_start_free")}>Start Free – 100 Credits</a><a className="marketing-button marketing-button--outline marketing-button--large" href={adminLoginPath} onClick={() => trackMarketingEvent("sign_in")}>Sign In</a></div></div></section>
      </main>

      <footer id="about" className="marketing-footer">
        <div className="marketing-container footer-main"><div><Brand /><p>Deploy, monitor, protect, build, and grow from one secure workspace.</p></div><div><strong>Product</strong><a href="#features">Features</a><a href="#ai-builder">AI Website Builder</a><a href="#seo">SEO Optimizer</a></div><div><strong>Platform</strong><a href="#operations">Operations</a><a href="#how-it-works">How It Works</a><a href={adminLoginPath}>Sign In</a></div></div>
        <a className="admin-diamond" href={adminLoginPath} aria-label="Super User sign in" title="Super User" onClick={() => trackMarketingEvent("super_user_access")}><span>OW</span></a>
        <div className="marketing-container footer-bottom"><span>© {new Date().getFullYear()} OpsWorkbench. All rights reserved.</span><span>Secure by design · Approval-gated operations</span></div>
      </footer>
    </div>
  );
}
