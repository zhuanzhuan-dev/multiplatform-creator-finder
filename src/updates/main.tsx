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
      <p className="lead">暂停后继续本轮，保留已有发现；上传在后台独立完成，找号节奏更连贯。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>暂停与继续</strong><span>继续原任务时保留计数、记录和目标，暂停时间不计入运行时长。停止或达到目标后，可开始新一轮。</span></li>
          <li><strong>独立后台同步</strong><span>刷推荐流不等待上传响应；暂停找号后，连接有效时已有队列继续同步。</span></li>
          <li><strong>结果更集中</strong><span>本轮结果下方显示最近 5 条记录，新增今日已刷，运行状态移入运行卡片。</span></li>
          <li><strong>连接与规则更清楚</strong><span>登录连接入口前置，设置中管理连接和主题；规则分为想找的内容与排除条件。</span></li>
          <li><strong>内容分类与计数</strong><span>分别记录直播、图文、广告及类型未确认的跳过原因，修正旧记录补传影响本轮同步计数的问题。</span></li>
          <li><strong>浅色材质</strong><span>柔白卡片、浅灰绿背景与按钮跟随高光，支持浅色、深色和跟随系统。</span></li>
        </ul>
      </section>
      <aside>重新加载扩展后打开侧栏。继续本轮需要原抖音任务页保持可用。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));
