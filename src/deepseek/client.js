// Native DSH client module; React is supplied by the host, no build/runtime dependency.
window.__ModuleLoader__.load({id:'agent-eta',factory:require=>{
  const R=require('react'),h=R.createElement;
  const duration=n=>n==null?'样本不足':n<1?`${Math.max(1,Math.round(n*60))} 秒`:`${n.toFixed(1)} 分钟`;
  const when=n=>n?new Date(n).toLocaleTimeString('zh-CN',{hour12:false}):'尚无记录';
  const preference='agent-eta:expanded';
  const initialExpanded=()=>{try{return localStorage.getItem(preference)!=='false';}catch{return true;}};
  const buttonStyle={border:'1px solid var(--dsw-alias-border-l1,#ddd)',background:'transparent',color:'inherit',borderRadius:6,padding:'3px 9px',cursor:'pointer',fontSize:12};

  function Panel({sessionId,useSession}) {
    const [response,setResponse]=R.useState(null),[offline,setOffline]=R.useState(false),
      [expanded,setExpanded]=R.useState(initialExpanded),[demo,setDemo]=R.useState(false);
    const hostRunning=typeof useSession==='function'?useSession(s=>s?.running):undefined;
    // A switched conversation must not flash the preceding conversation's receipt.
    const data=response?.sessionId===sessionId?response.value:null;
    R.useEffect(()=>{
      let stopped=false,timer,controller;
      setResponse(null);setOffline(false);setDemo(false);
      const poll=async()=>{
        controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),4000);
        try {
          const res=await fetch(`/agent-eta/status?session=${encodeURIComponent(sessionId??'')}`,{signal:controller.signal});
          if(!res.ok)throw Error('offline');
          const value=await res.json();
          if(!stopped){setResponse({sessionId,value});setOffline(false);}
        }catch{if(!stopped)setOffline(true);}
        finally{clearTimeout(timeout);if(!stopped)timer=setTimeout(poll,2000);}
      };
      poll();return()=>{stopped=true;clearTimeout(timer);controller?.abort();};
    },[sessionId]);
    const p=demo?{at:Date.now(),status:'experimental',historyCount:8,original:{p50:4.2,p20:2,p80:7},
      candidate:{forecast:{p50:5.6,p20:3,p80:9},method:'neighbours'},
      features:{steps:5,unresolved:true,rework:true}}:data?.prediction;
    const running=demo||hostRunning===true||(hostRunning===undefined&&data?.running);
    const stale=!demo&&p&&Date.now()-p.at>60000;
    const invalid=data?.error||data?.observationState==='invalid';
    const valid=demo||(!offline&&!invalid&&running&&!stale&&p?.status==='experimental');
    const old=valid?p.original:null,newer=valid?p.candidate?.forecast:null;
    const status=offline?'连接中断':!data?'正在连接':data.error?'记录异常':
      data.incompleteLines?'记录已开启 · 历史有缺口':'记录已开启';
    const numbers=old?`原算法约 ${duration(old.p50)} · 新算法${newer?`约 ${duration(newer.p50)}`:'样本不足'}`:null;
    const summary=demo?`界面演示 · ${numbers}`:offline?'暂时无法获取预计时间':
      !data?'正在读取记录状态':invalid?'记录不完整，暂停估算':!running?'当前没有执行中的任务':
      !p?'正在执行 · 等待已保存的步骤记录':p.status==='waiting'?'等待你的操作，计时暂停':
      p.status==='invalid'?'记录不完整，暂停估算':stale?'预测暂未更新，等待下一条步骤记录':
      numbers?`上次预计剩余：${numbers}`:`正在执行 · 可比历史 ${p.historyCount??0}/3 条`;
    const missing=offline?'连接中断':invalid?'暂停估算':!running?'—':stale||!p?'等待更新':
      p.status==='waiting'?'已暂停':'样本不足';
    const coldNote=running&&p&&!old&&p.status==='experimental'&&!stale
      ?`还需 ${Math.max(0,3-(p.historyCount??0))} 条可比历史；正常使用即可`:'有新步骤时更新已保存的预测';
    const cell=(label,value,note)=>h('div',{style:{flex:'1 1 170px',padding:'9px 12px',borderRadius:8,background:'var(--dsw-alias-bg-base,transparent)'}},
      h('div',{style:{fontSize:12,opacity:.7}},label),
      h('div',{style:{fontSize:19,fontWeight:600,margin:'4px 0'}},value),
      h('div',{style:{fontSize:11,opacity:.65}},note));
    const toggle=()=>setExpanded(previous=>{
      const next=!previous;try{localStorage.setItem(preference,String(next));}catch{/* Optional preference. */}return next;
    });
    const progress=demo?'已完成 5 步 · 测试失败后返工中（演示）':
      running&&p?`已完成 ${p.features.steps} 步 · ${p.features.unresolved?'测试失败尚未解除':'未观察到未解除的测试失败'}${p.features.rework?' · 已观察到返工':''}`:
      running?'正在等待读取步骤状态':'有新任务时自动更新步骤、测试与返工状态';
    return h('section',{'aria-label':'Agent ETA 状态面板',style:{margin:'8px auto',padding:'12px 16px',maxWidth:960,width:'calc(100% - 32px)',boxSizing:'border-box',border:'1px solid var(--dsw-alias-border-l1,#ddd)',borderRadius:12,color:'var(--dsw-alias-label-primary,inherit)',background:'var(--dsw-specific-menu,transparent)',fontFamily:'inherit',fontSize:13}},
      h('div',{style:{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}},
        h('strong',null,'Agent ETA'),h('span',{style:{color:offline||data?.error?'#c67020':'#32916b'}},`● ${status}`),
        h('span',{style:{flex:1}},summary),h('button',{style:buttonStyle,onClick:toggle,'aria-expanded':expanded},expanded?'收起对照':'展开对照')),
      expanded&&h('div',null,
        demo&&h('p',{role:'status',style:{color:'#b47020',margin:'10px 0 0'}},'界面演示 · 数值为固定示例，不是实际预测，不写入真实记录'),
        h('div',{style:{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}},
          cell('原算法 · 当前基线',old?duration(old.p50):missing,old?`估计范围 ${duration(old.p20)} – ${duration(old.p80)}`:coldNote),
          cell('新算法 · 旁录对照',newer?duration(newer.p50):missing,newer?(p.candidate.method==='original_fallback'?'样本不足，暂时沿用原算法':`估计范围 ${duration(newer.p20)} – ${duration(newer.p80)}`):'实验算法，尚未证明更准')),
        h('div',{style:{marginTop:10,lineHeight:1.8,opacity:.8}},progress,
          p&&running&&h('span',null,h('br'),demo?'预测时间：演示示例':`已保存预测的时间 ${when(p.at)}${stale?' · 超过 60 秒未更新，暂不显示旧数字':''}`),
          h('br'),`${offline?'上次确认：':''}本对话已记录 ${data?.session?.receipts??0} 条 · 全部 ${data?.receipts??0} 条 · 最近写入 ${when(data?.session?.lastWrite)}`,
          data?.incompleteLines>0&&h('span',null,h('br'),`发现 ${data.incompleteLines} 条历史记录不完整，已跳过`),
          h('br'),'仅本地计算 · 不增加模型调用 · 重启后重新积累估算样本'),
        h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}},
          h('small',{style:{opacity:.6}},'预计时间是估计，不是完成承诺'),
          h('button',{style:buttonStyle,onClick:()=>setDemo(!demo)},demo?'退出演示':'零费用界面演示'))));
  }
  return {inject:['slots'],apply(ctx){ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:'agent-eta-status',order:30},Panel));}};
}});
