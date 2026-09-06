import { StrictMode } from "react";
import { themeReady } from "../shared/theme";
import { createRoot } from "react-dom/client";
import "./styles.css";

const manifest = chrome.runtime.getManifest();
const visibleVersion = manifest.version_name || manifest.version;
const previousVersion = new URLSearchParams(location.search).get("from");
const iconUrl = chrome.runtime.getURL("icons/icon-128.png");

function UpdatePage() {
  return (
    <main>
      <header>
        <img className="product-icon" src={iconUrl} alt="多平台自动找号助手图标" />
        <div>
          <p className="eyebrow">版本更新</p>
          <h1>V{visibleVersion} 已就绪</h1>
        </div>
      </header>
      <p className="lead">收起面板，任务继续。通过页面悬浮入口或工具栏状态图标，随时回到找号助手。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>悬浮任务入口</strong><span>抖音页面右侧显示雷达按钮，点击恢复侧栏；展开侧栏时自动隐藏。</span></li>
          <li><strong>状态随时可见</strong><span>区分运行、暂停和结束状态，工具栏图标同步显示任务角标。</span></li>
          <li><strong>位置与外观</strong><span>沿右边缘拖动并记住位置，支持键盘上下调整、浅色与深色主题，以及减少动态效果。</span></li>
        </ul>
      </section>
      <aside>关闭侧栏后任务继续运行。关闭推荐流任务页会暂停找号，退出 Chrome 后任务无法继续执行。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));
