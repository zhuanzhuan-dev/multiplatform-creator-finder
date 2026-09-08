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
      <p className="lead">新增当前推荐卡片的视频发布时间、当前视频封面和已加载作者作品封面的读取与上传。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>读取发布时间</strong><span>从当前卡片的专用时间节点读取，排除隐藏节点、作者侧栏和视频文案中的时间。</span></li>
          <li><strong>保留时间精度</strong><span>“9小时前”等相对时间会标记为估算值，原文与精度一并保存；无法识别时保留原文，时间留空。</span></li>
          <li><strong>采集封面地址</strong><span>读取当前视频封面及作者已加载作品封面，作品关联视频 ID 和链接，去重后最多上传 24 条。过滤已识别占位图，缺失信息留空。</span></li>
          <li><strong>上传采集字段</strong><span>发布时间与采集时间分别上传。研究台的日期与封面展示需要单独接入。</span></li>
        </ul>
      </section>
      <aside>已验证给定 HTML 结构。真实抖音页面的节点覆盖率，以及研究台是否保存并展示这些字段，仍需试用核验。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));
