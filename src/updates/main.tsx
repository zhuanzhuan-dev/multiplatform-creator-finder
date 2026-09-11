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
      <p className="lead">修复全新安装时抖音采集界面显示“当前页面尚未适配”的问题。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>首次安装即可打开抖音采集</strong><span>没有历史任务时也能显示抖音任务界面，设置目标后即可开始本轮。</span></li>
          <li><strong>平台选择正确生效</strong><span>手动选择抖音，或跟随当前抖音推荐页时，均展示对应任务界面。任务仍由用户手动启动。</span></li>
          <li><strong>恢复任务入口</strong><span>修复已保存的飞瓜、快手任务路由为空时，恢复后无法显示采集界面的问题。</span></li>
          <li><strong>采集前等待资料稳定</strong><span>抖音等待达人资料和作品列表稳定；飞瓜改善列表加载与图片地址读取，减少加载过程中遗漏字段。</span></li>
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
