import { StrictMode } from "react";
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
      <p className="lead">首次点击即可打开助手，运行设置自动保存，并提供默认的正态随机停留预设。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>一次打开</strong><span>在任意标签页打开侧栏，点击“开始本轮”时选择或创建抖音推荐页。</span></li>
          <li><strong>工作台入口</strong><span>顶部新增“打开工作台”，可直接进入研究台。</span></li>
          <li><strong>自动保存</strong><span>运行设置编辑后自动保存，关闭重开仍保留；尚未通过校验的内容保存为草稿。</span></li>
          <li><strong>随机预设</strong><span>新配置默认在 10–30 秒间按截断正态分布取值，中心为 20 秒。已保存的停留模式继续保留，可点击“应用随机预设”切换。</span></li>
        </ul>
      </section>
      <aside>更新后请刷新已打开的抖音页面。随机节奏无法保证避免平台风控；运行期间保持电脑唤醒、Chrome 运行及网络可用。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>);
