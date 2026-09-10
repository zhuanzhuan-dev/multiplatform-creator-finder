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
          <h1>已更新至 V{visibleVersion}</h1>
        </div>
      </header>
      <p className="lead">新增快手推荐流采集，多平台独立运行，悬浮入口清晰展示各平台进度。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>多平台悬浮状态</strong><span>抖音、快手分别显示已刷条数，飞瓜显示已采集页数。只展示运行、启动和暂停中的任务，点击对应行打开该平台面板。</span></li>
          <li><strong>快手推荐流</strong><span>支持推荐视频采集、筛选与后台继续，复用抖音组件与筛选逻辑。</span></li>
          <li><strong>任务与设置独立</strong><span>抖音、快手可以并行采集，分别保存设置、规则和草稿；暂停与运行控制互不影响。</span></li>
          <li><strong>统一上传队列</strong><span>各平台结果共用串行上传队列，上传进度分别归属各自任务。今日已刷保留全平台汇总及平台筛选。</span></li>
        </ul>
      </section>
      <aside>更新后请刷新采集网页，并检查当前平台的采集目标和本地测试模式，再手动继续任务。飞瓜上传保持原设置。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));
