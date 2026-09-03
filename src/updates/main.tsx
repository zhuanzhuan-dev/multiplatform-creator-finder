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
      <p className="lead">多平台自动找号助手现在拥有清晰、统一的扩展图标，在扩展管理页、浏览器工具栏和系统界面中都能快速识别。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>全新图标</strong><span>使用“达人搜索与多平台连接”视觉符号，替换 Chrome 自动生成的灰色文字占位图。</span></li>
          <li><strong>清晰适配</strong><span>提供 16、32、48 和 128 像素四档资源，在工具栏和扩展管理页保持清晰。</span></li>
          <li><strong>轻量发布</strong><span>按实际显示尺寸压缩图标资源，四档文件合计约 33 KiB，不把高分辨率母版打入扩展。</span></li>
        </ul>
      </section>
      <aside>如果工具栏仍显示旧图标，请在扩展管理页重新加载扩展，或重启 Chrome 刷新图标缓存。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>);
