// app.js — Application entry point and tab router for ATIS

const App = {

  currentTab: 'market',

  init() {
    App.initTabs();
    App.startClock();
    App.initModules();
    App.checkEmergencyState();
    App.loadInitialTab();

    console.log('%cATIS v1.0 — Phase 1 Research Dashboard', 'color:#00d4ff;font-weight:bold;font-size:14px');
    console.log('%cAutonomous Trading Intelligence System', 'color:#7a8fb5');
  },

  initTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;
        App.switchTab(tabId);
      });
    });
  },

  switchTab(tabId) {
    // Deactivate all
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    // Activate selected
    const tab   = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
    const panel = document.getElementById(`tab-${tabId}`);

    if (tab) tab.classList.add('active');
    if (panel) panel.classList.add('active');

    App.currentTab = tabId;

    // Update URL hash (enables bookmarking / back button)
    history.replaceState(null, '', `#${tabId}`);

    // Tab-specific refresh actions
    switch (tabId) {
      case 'market':
        Dashboard.renderFromCache();
        break;
      case 'watchlist':
        Watchlist.render();
        break;
      case 'macro':
        Macro.renderFromCache();
        break;
      case 'portfolio':
        Portfolio.render();
        break;
      case 'journal':
        Journal.render();
        break;
      case 'reports':
        // Re-render active report period
        const activeReport = document.querySelector('.tab-sub[data-report].active');
        if (activeReport) Reports.render(activeReport.dataset.report);
        break;
      case 'agents':
        Agents.renderHealth();
        Agents.updateCostEstimate();
        break;
    }
  },

  loadInitialTab() {
    const hash = window.location.hash.replace('#', '');
    const validTabs = ['market','watchlist','macro','scanner','portfolio','journal','reports','backtest','agents'];
    App.switchTab(validTabs.includes(hash) ? hash : 'market');
  },

  startClock() {
    const update = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
      });
      Utils.setText('systemTime', timeStr);
    };
    update();
    setInterval(update, 1000);
  },

  checkEmergencyState() {
    const portfolio  = Storage.getPortfolio();
    const riskState  = Storage.getRiskState();

    if (riskState.hardFloorBreached || portfolio.currentValue <= 250) {
      Utils.show('emergencyBanner');
      Utils.el('statusRisk').querySelector('.dot').className = 'dot dot--danger';
    }
  },

  initModules() {
    // Initialize all tab modules
    Dashboard.init();
    Watchlist.init();
    Macro.init();
    Portfolio.init();
    Journal.init();
    Reports.init();
    Agents.init();

    // Modules not yet active in Phase 1 (scanner, backtest) need no init
  },

  // Periodic background checks (every 5 minutes)
  startBackgroundTasks() {
    setInterval(() => {
      // Update storage size display if on agents tab
      if (App.currentTab === 'agents') {
        Utils.setText('healthStorageSize', `${Utils.getStorageSizeKB()} KB used`);
      }

      // Run storage cleanup
      Storage.cleanup();

      // Check emergency state
      App.checkEmergencyState();
    }, 5 * 60 * 1000);
  }
};

// Boot when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.startBackgroundTasks();
});

// Handle browser back/forward navigation
window.addEventListener('popstate', () => {
  const hash = window.location.hash.replace('#', '');
  if (hash) App.switchTab(hash);
});
