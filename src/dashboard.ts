export const dashboard = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VRChat · YouTube 任务</title><style>
:root{color-scheme:dark;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#11151c;color:#e6eaf1;line-height:1.6}*{box-sizing:border-box}body{max-width:1000px;margin:0 auto;padding:32px 20px 60px}header{display:flex;justify-content:space-between;align-items:center;gap:16px}h1{font-size:26px;margin:0}h2{font-size:18px;margin:0 0 12px}p{margin:8px 0}small,.muted{color:#a4afc0}.card,form{padding:20px;background:#1b2230;border:1px solid #303b4d;border-radius:12px;margin:16px 0}.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}input,select,button{font:inherit;border-radius:7px;padding:9px 12px;border:1px solid #46536b;background:#151c28;color:inherit}input{flex:1;min-width:220px}select{max-width:100%}button{cursor:pointer;background:#2c4663}button:hover{background:#3b5d82}button:disabled{cursor:default;opacity:.45}button.secondary{background:transparent}label{display:block;margin-bottom:7px}progress{display:block;width:100%;height:12px;accent-color:#67cfb3;margin:12px 0}.badge{padding:2px 9px;border:1px solid #5e718b;border-radius:99px;font-size:13px}.error{color:#ffb0ae;white-space:pre-wrap;overflow-wrap:anywhere}.notice{color:#ebcd8e;font-size:14px}#message{white-space:pre-wrap;overflow-wrap:anywhere;min-height:26px}footer{margin-top:28px;font-size:14px}.title{overflow-wrap:anywhere}.task-head{display:flex;justify-content:space-between;align-items:start;gap:14px}.actions{margin-top:14px}@media(max-width:600px){body{padding:20px 12px}header{align-items:start}h1{font-size:22px}.row input,.row select{width:100%}}
</style></head><body>
<header><div><h1>YouTube 播放任务</h1><p class="muted">VRChat 本地转发 · 复制源编码</p></div><span id="version" class="badge">连接中</span></header>
<form id="resolve"><label for="url">YouTube 视频链接</label><div class="row"><input id="url" name="url" type="url" placeholder="https://youtu.be/…" required autocomplete="off"><button id="submit">解析视频</button></div>
<div style="margin-top:14px"><label for="mode">本次播放方式</label><select id="mode"><option value="lossless">原始画质 · 完整 MP4</option><option value="lossless-compatible">H.264/AAC 兼容 · 完整 MP4</option><option value="lossless-hls">原始画质 · HLS 边准备边播（实验）</option><option value="lossless-hls-compatible">H.264/AAC 兼容 · HLS 边准备边播（实验）</option><option value="hls-direct">直播 / 单流直通</option><option value="mp4">旧版 MP4 单流直通</option></select></div>
<p class="muted"><small>仅影响本次解析。VRChat 自动解析使用配置文件中的模式；兼容模式只选源站现有 H.264/AAC，清晰度可能低于最高格式。</small></p></form>
<p id="message" role="status" aria-live="polite"></p>
<div class="row"><h2 style="margin:0;flex:1">任务与缓存</h2><button id="clear" class="secondary">清理未使用缓存</button></div>
<p class="muted"><small>正在准备或最近 2 分钟内访问的缓存会保留。取消任务会停止下载并清理未完成文件。</small></p>
<div id="tasks"><p class="muted">正在读取任务…</p></div>
<footer class="muted">HLS 首个完整片段生成后即可播放；准备期间仅能跳转到已生成的位置。源编码和 HLS 支持取决于地图播放器，工具不会自动转码或降低画质。<br>此面板及播放地址只供本机使用，其他玩家仍使用原始 YouTube 链接。</footer>
<script>
const $=id=>document.getElementById(id);
let token='',polling=false,initialized=false;
const cards=new Map();
const states={queued:'排队中',preparing:'正在准备',cancelling:'正在取消',cancelled:'已取消',ready:'已就绪',failed:'失败',evicted:'缓存已清理'};
const modes={'lossless':'原始画质 MP4','lossless-compatible':'兼容 MP4','lossless-hls':'原始画质 HLS','lossless-hls-compatible':'兼容 HLS','hls-mux':'原始画质 MP4'};
const seconds=n=>{n=Math.max(0,Math.floor(n||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0')};
const bytes=n=>n>=1073741824?(n/1073741824).toFixed(2)+' GiB':(n/1048576).toFixed(1)+' MiB';
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':''}
async function api(url,body){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Control-Token':token},body:JSON.stringify(body||{})});
  const data=await response.json();
  if(!response.ok||data.code===1)throw Error(data.error||'操作失败');
  return data;
}
function element(tag,className,text){const e=document.createElement(tag);e.className=className||'';if(text!==undefined)e.textContent=text;return e}
function card(job){
  let c=cards.get(job.id);if(c)return c;
  c={root:element('article','card'),job};
  const head=element('div','task-head');c.title=element('h2','title');c.state=element('span','badge');head.append(c.title,c.state);
  c.detail=element('p','muted');c.progress=element('progress');c.progress.max=100;c.progress.setAttribute('aria-label','准备进度');
  c.status=element('p');c.warning=element('p','notice');c.error=element('p','error');
  const actions=element('div','row actions');
  const action=(text,fn)=>{
    const b=element('button','secondary',text);
    b.onclick=async()=>{c.busy=true;b.disabled=true;try{await fn(c.job)}catch(e){message(e.message,true)}finally{c.busy=false;await refresh()}};
    actions.append(b);return b;
  };
  c.copy=action('复制播放地址',async j=>{await navigator.clipboard.writeText(j.playbackUrl);message('已复制本机播放地址')});
  c.cancel=action('取消',async j=>{await api('/jobs/'+j.id+'/cancel');message('已请求取消')});
  c.retry=action('重新解析并重试',async j=>{await api('/jobs/'+j.id+'/retry');message('已重新获取源链接并提交任务')});
  c.root.append(head,c.detail,c.progress,c.status,c.warning,c.error,actions);cards.set(job.id,c);return c;
}
async function refresh(){
  if(polling)return;polling=true;
  try{
    const response=await fetch('/status',{cache:'no-store'});if(!response.ok)throw Error('服务暂时不可用');
    const data=await response.json();token=data.controlToken;$('version').textContent='v'+data.version;
    if(!initialized){$('mode').value=data.mode==='hls-mux'?'lossless':data.mode;initialized=true}
    const ids=new Set(data.jobs.map(j=>j.id));for(const [id,c] of cards)if(!ids.has(id)){c.root.remove();cards.delete(id)}
    if(!data.jobs.length){$('tasks').replaceChildren(element('p','muted','暂无任务。VRChat 解析 YouTube 链接后会自动出现在这里。'));return}
    if(!cards.size)$('tasks').replaceChildren();
    for(const job of data.jobs.slice().reverse()){
      const c=card(job);c.job=job;c.title.textContent=job.title||job.videoId;c.state.textContent=states[job.state];
      c.detail.textContent=(modes[job.mode]||job.mode)+' · '+(job.height?job.height+'p':'未知分辨率')+(job.fps?' / '+job.fps+' fps':'')+' · '+job.videoCodec+' + '+job.audioCodec;
      c.progress.value=job.progressPercent||0;
      c.status.textContent=bytes(job.bytes)+' · 已处理 '+seconds(job.mediaSeconds)+(job.duration?' / '+seconds(job.duration):'')+(job.queuePosition?' · 队列第 '+job.queuePosition+' 位':'')+(job.remainingSeconds!==undefined?' · 预计剩余 '+seconds(job.remainingSeconds):'')+(job.delivery==='hls'?' · 可播放至 '+seconds(job.availableSeconds):'');
      c.warning.textContent=(job.warnings||[]).join(' ');c.error.textContent=job.error||'';
      c.copy.disabled=c.busy||!job.playbackUrl||['cancelled','cancelling','failed','evicted'].includes(job.state);
      c.cancel.disabled=c.busy||!['queued','preparing'].includes(job.state);c.retry.disabled=c.busy||!['failed','cancelled','evicted'].includes(job.state);
      if(!c.root.isConnected)$('tasks').append(c.root);
    }
  }catch(e){$('version').textContent='连接断开';message('无法连接本机服务，请确认工具仍在运行。',true)}
  finally{polling=false}
}
$('resolve').onsubmit=async e=>{
  e.preventDefault();$('submit').disabled=true;message('正在解析源视频…');
  try{const result=await api('/fetch-link',{url:$('url').value,mode:$('mode').value});message(result.jobId?'已提交任务，准备进度见下方。':'直通播放地址：'+result.text);await refresh()}
  catch(e){message(e.message,true)}finally{$('submit').disabled=false}
};
$('clear').onclick=async()=>{
  $('clear').disabled=true;
  try{const result=await api('/cache/clear');message('已释放 '+bytes(result.freedBytes)+'，保留 '+bytes(result.usedBytes));await refresh()}
  catch(e){message(e.message,true)}finally{$('clear').disabled=false}
};
refresh();setInterval(refresh,1500);
</script></body></html>`;
