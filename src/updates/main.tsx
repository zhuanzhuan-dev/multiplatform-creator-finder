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
      <p className="lead">运行概览改为紧凑的结果摘要，首页保留关键指标，过程数据按需展开。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>关键结果一眼可见</strong><span>规则命中、新增账号和需复核入表保持展示，移除重复卡片边框和累计说明。</span></li>
          <li><strong>过程明细按需展开</strong><span>已刷和已上传显示在一行，去重、标记不感兴趣及跳过原因点击查看。</span></li>
          <li><strong>清晰的状态层级</strong><span>有需复核记录时用琥珀色强调，为零时显示中性色，支持键盘展开和大字号换行。</span></li>
        </ul>
      </section>
      <aside>重新加载扩展并打开侧栏即可看到新布局。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));
