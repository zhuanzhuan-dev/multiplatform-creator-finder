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
      <p className="lead">飞瓜采集与抖音独立运行，本地观察默认保留 24 小时，等待上传的数据继续保留。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>24 小时自动清理</strong><span>本地观察每小时检查过期数据，启动时补清理。待上传和上传失败的记录保留，服务端确认成功或重复后才按期限清理。</span></li>
          <li><strong>持续本地采集</strong><span>观察数据按条保存，取消原来的 6 MB／6,000 条限制。旧数据自动迁移，迁移成功后清理旧副本。</span></li>
          <li><strong>飞瓜独立采集</strong><span>支持视频库自动翻页及默认开启的浏览采集。用户进入详情或接管列表时暂停自动翻页；飞瓜当前仅保存本地。</span></li>
          <li><strong>等图片加载再采集</strong><span>等待头像、封面和行数据就绪后保存，图片超时则暂停，避免缺失数据就翻页。</span></li>
          <li><strong>平台记录分开查看</strong><span>抖音、飞瓜页面各显示自己的最近 5 条和数量，近 24 小时记录页支持全部来源和平台筛选。各平台上传共用串行队列。</span></li>
          <li><strong>跨网页悬浮入口</strong><span>支持移动、缩小与隐藏设置，切换网页后仍可打开插件。</span></li>
        </ul>
      </section>
      <aside>更新后请刷新采集网页并手动继续任务。超过 24 小时且无需等待上传的旧观察会被清理，需要长期保留的内容请及时导出。抖音上传保持原设置，飞瓜上传继续关闭。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));
