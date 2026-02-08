"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import * as d3 from "d3";
import { AQUATIC_WALLET, HELIUS_KEY, fmt, fUsd, sAddr, pCol } from "@/lib/config";
import { getSolBalance, getTokenAccounts, dexTokens, dexPairs, getSolPrice, fetchSwaps, fetchTransfers, buildCostBasis, enrichTokens, buildSnapshot, buildHistoricalData, solanPayUrl, refreshTokenPrices, refreshHoldings, tokenTotalPnl, findBestTrade } from "@/lib/api";

function mkNoise(w=200,h=200,op=0.025){if(typeof document==="undefined")return"";const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d"),im=ctx.createImageData(w,h);for(let i=0;i<im.data.length;i+=4){const v=Math.random()*255;im.data[i]=v;im.data[i+1]=v;im.data[i+2]=v;im.data[i+3]=op*255;}ctx.putImageData(im,0,0);return c.toDataURL();}
function QRImg({url,size=180}){const ref=useRef(null);useEffect(()=>{if(!ref.current||!url)return;const c=ref.current,ctx=c.getContext("2d"),img=new Image();img.crossOrigin="anonymous";img.onload=()=>{ctx.clearRect(0,0,size,size);ctx.drawImage(img,0,0,size,size);};img.src=`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&bgcolor=0a1220&color=00ff88&format=png`;},[url,size]);return <canvas ref={ref} width={size} height={size} style={{borderRadius:12,border:"1px solid rgba(0,255,136,0.15)"}}/>;}
function CardParticles({active}){if(!active)return null;return(<div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",borderRadius:12}}>{Array.from({length:6},(_,i)=>(<div key={i} style={{position:"absolute",width:3,height:3,borderRadius:"50%",background:["#9945ff","#00ff88","#14f195","#ffaa00","#7799ee","#ff4466"][i],left:`${15+i*14}%`,top:`${20+(i%3)*25}%`,opacity:0.7,animation:`floatStar ${1.5+i*0.3}s ease-in-out infinite`,animationDelay:`${i*0.2}s`}}/>))}</div>);}
function Spark({data,color,w=100,h=28}){const ref=useRef(null);useEffect(()=>{if(!ref.current||!data?.length)return;const svg=d3.select(ref.current);svg.selectAll("*").remove();const x=d3.scaleLinear().domain([0,data.length-1]).range([0,w]);const y=d3.scaleLinear().domain([d3.min(data)*0.97,d3.max(data)*1.03]).range([h-1,1]);const gId="s"+Math.random().toString(36).slice(2,8);const defs=svg.append("defs");const gr=defs.append("linearGradient").attr("id",gId).attr("x1",0).attr("y1",0).attr("x2",0).attr("y2",1);gr.append("stop").attr("offset","0%").attr("stop-color",color).attr("stop-opacity",0.3);gr.append("stop").attr("offset","100%").attr("stop-color",color).attr("stop-opacity",0);svg.append("path").datum(data).attr("d",d3.area().x((_,i)=>x(i)).y0(h).y1(d=>y(d)).curve(d3.curveMonotoneX)).attr("fill",`url(#${gId})`);svg.append("path").datum(data).attr("d",d3.line().x((_,i)=>x(i)).y(d=>y(d)).curve(d3.curveMonotoneX)).attr("fill","none").attr("stroke",color).attr("stroke-width",1.5);},[data,color,w,h]);return <svg ref={ref} width={w} height={h}/>;}
const Stat=({l,v,cl})=>(<div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"9px 11px"}}><div style={{fontSize:8,color:"#556677",textTransform:"uppercase",letterSpacing:1,fontWeight:700,marginBottom:2}}>{l}</div><div style={{fontSize:13,fontWeight:800,color:cl||"#c8d0e0",fontFeatureSettings:"'tnum'"}}>{v}</div></div>);

// FIX #1: Pie Chart - properly shows SOL + each token as colored slices
function Pie({data,size=260}){
  const ref=useRef(null);
  useEffect(()=>{
    if(!ref.current||!data?.length)return;
    const svg=d3.select(ref.current);svg.selectAll("*").remove();
    const r=size/2-10;
    const g=svg.append("g").attr("transform",`translate(${size/2},${size/2})`);
    const cols=["#9945ff","#00ff88","#ff4466","#ffaa00","#14f195","#7799ee","#ff6688","#44ddff","#ff9944","#aa66ff"];
    const col=d3.scaleOrdinal(cols);
    const pie=d3.pie().value(d=>d.value).sort(null).padAngle(0.03);
    const arc=d3.arc().innerRadius(r*0.55).outerRadius(r);
    const arcH=d3.arc().innerRadius(r*0.52).outerRadius(r+6);
    const tt=d3.select(ref.current.parentNode).append("div").style("position","absolute").style("display","none").style("background","rgba(8,14,25,0.96)").style("border","1px solid rgba(255,255,255,0.12)").style("border-radius","8px").style("padding","8px 12px").style("font-size","11px").style("color","#c8d0e0").style("pointer-events","none").style("z-index",10).style("box-shadow","0 6px 20px rgba(0,0,0,0.5)");
    g.selectAll("path").data(pie(data)).enter().append("path")
      .attr("d",arc).attr("fill",(_,i)=>col(i)).attr("stroke","#0a1220").attr("stroke-width",2)
      .style("opacity",0.88).style("cursor","pointer")
      .on("mouseenter",function(ev,d){d3.select(this).transition().duration(120).attr("d",arcH).style("opacity",1);tt.style("display","block").html(`<b style="color:${col(d.index)}">${d.data.label}</b><br/>${fUsd(d.data.value)}<br/><b>${d.data.pct.toFixed(1)}%</b>`);})
      .on("mousemove",function(ev){const[x,y]=d3.pointer(ev,ref.current);tt.style("left",x+14+"px").style("top",y-10+"px");})
      .on("mouseleave",function(){d3.select(this).transition().duration(120).attr("d",arc).style("opacity",0.88);tt.style("display","none");});
    // Outer labels
    pie(data).forEach((d,i)=>{
      if(d.data.pct<4)return;
      const mid=(d.startAngle+d.endAngle)/2;
      const lx=Math.sin(mid)*(r+20);
      const ly=-Math.cos(mid)*(r+20);
      g.append("text").attr("x",lx).attr("y",ly).attr("text-anchor","middle").attr("dominant-baseline","central").attr("fill",col(i)).attr("font-size",9).attr("font-weight",800).text(d.data.label);
    });
    g.append("text").attr("text-anchor","middle").attr("dy","-0.3em").attr("fill","#667788").attr("font-size",8).attr("font-weight",700).attr("letter-spacing",1.5).text("PORTFOLIO");
    g.append("text").attr("text-anchor","middle").attr("dy","1.2em").attr("fill","#e8edf5").attr("font-size",15).attr("font-weight",900).text(fUsd(data.reduce((s,d)=>s+d.value,0)));
    return()=>tt.remove();
  },[data,size]);
  return <div style={{position:"relative",display:"inline-block"}}><svg ref={ref} width={size} height={size}/></div>;
}

// FIX #6 PnL Distribution - top 5 $ticker with SOL values
function PnlDistChart({cb,tokens}){
  const ref=useRef(null);
  useEffect(()=>{
    if(!ref.current||!cb||!Object.keys(cb).length)return;
    const svg=d3.select(ref.current);svg.selectAll("*").remove();
    const W=ref.current.clientWidth||260,H=220;
    const M={t:14,r:12,b:30,l:12};
    const entries=Object.entries(cb).map(([mint,c])=>{
      const tok=tokens.find(t=>t.mint===mint);
      return{mint,pnl:tokenTotalPnl(c,tok),symbol:tok?.symbol||sAddr(mint)};
    }).sort((a,b)=>Math.abs(b.pnl)-Math.abs(a.pnl)).slice(0,5);
    const x=d3.scaleBand().domain(entries.map((_,i)=>i)).range([M.l,W-M.r]).padding(0.22);
    const yMax=Math.max(Math.abs(d3.min(entries,d=>d.pnl)||0),d3.max(entries,d=>d.pnl)||0)*1.2||1;
    const y=d3.scaleLinear().domain([-yMax,yMax]).range([H-M.b,M.t]);
    svg.append("line").attr("x1",M.l).attr("x2",W-M.r).attr("y1",y(0)).attr("y2",y(0)).attr("stroke","#445566").attr("stroke-width",1).attr("stroke-dasharray","3,3");
    entries.forEach((e,i)=>{
      const barY=e.pnl>=0?y(e.pnl):y(0);
      const barH=Math.abs(y(e.pnl)-y(0));
      const col=e.pnl>=0?"#00ff88":"#ff4466";
      svg.append("rect").attr("x",x(i)).attr("width",x.bandwidth()).attr("y",barY).attr("height",Math.max(barH,1)).attr("fill",col).attr("rx",3).attr("opacity",0.85);
      const valY=e.pnl>=0?barY-4:barY+barH+10;
      svg.append("text").attr("x",x(i)+x.bandwidth()/2).attr("y",valY).attr("text-anchor","middle").attr("fill",col).attr("font-size",9).attr("font-weight",800).text((e.pnl>=0?"+":"")+fmt(e.pnl,3));
      svg.append("text").attr("x",x(i)+x.bandwidth()/2).attr("y",H-6).attr("text-anchor","middle").attr("fill","#8899aa").attr("font-size",8).attr("font-weight",700).text("$"+e.symbol);
    });
  },[cb,tokens]);
  return <svg ref={ref} width="100%" height={220} style={{overflow:"visible"}}/>;
}

// Portfolio Chart (smaller, simpler - in 3-panel area only)
function PortfolioChart({histData,solPrice,yMode}){
  const ref=useRef(null);
  useEffect(()=>{
    if(!ref.current||!histData?.length)return;
    const svg=d3.select(ref.current);svg.selectAll("*").remove();
    const W=ref.current.clientWidth||500,H=280;
    const M={t:24,r:14,b:34,l:54};
    const mul=yMode==="usd"?(solPrice||1):1;
    const x=d3.scaleTime().domain(d3.extent(histData,d=>d.date)).range([M.l,W-M.r]);
    const yMax=d3.max(histData,d=>d.totalSol*mul)*1.15||1;
    const y=d3.scaleLinear().domain([0,yMax]).range([H-M.b,M.t]);
    y.ticks(6).forEach(t=>{svg.append("line").attr("x1",M.l).attr("x2",W-M.r).attr("y1",y(t)).attr("y2",y(t)).attr("stroke","#141e2e").attr("stroke-dasharray","2,3");svg.append("text").attr("x",M.l-6).attr("y",y(t)+3).attr("text-anchor","end").attr("fill","#445566").attr("font-size",8).text(yMode==="usd"?"$"+fmt(t,0):fmt(t,2));});
    x.ticks(Math.min(8,histData.length)).forEach(t=>{svg.append("text").attr("x",x(t)).attr("y",H-8).attr("text-anchor","middle").attr("fill","#445566").attr("font-size",8).text((t.getMonth()+1)+"/"+t.getDate());});
    const defs=svg.append("defs");
    const aGId="ta"+Math.random().toString(36).slice(2,6);
    const aGr=defs.append("linearGradient").attr("id",aGId).attr("x1",0).attr("y1",0).attr("x2",0).attr("y2",1);
    aGr.append("stop").attr("offset","0%").attr("stop-color","#00ff88").attr("stop-opacity",0.12);
    aGr.append("stop").attr("offset","100%").attr("stop-color","#00ff88").attr("stop-opacity",0);
    svg.append("path").datum(histData).attr("d",d3.area().x(d=>x(d.date)).y0(H-M.b).y1(d=>y(d.totalSol*mul)).curve(d3.curveMonotoneX)).attr("fill",`url(#${aGId})`);
    svg.append("path").datum(histData).attr("d",d3.line().x(d=>x(d.date)).y(d=>y(d.solBal*mul)).curve(d3.curveMonotoneX)).attr("fill","none").attr("stroke","#9945ff").attr("stroke-width",1.5).attr("opacity",0.7);
    svg.append("path").datum(histData).attr("d",d3.line().x(d=>x(d.date)).y(d=>y(d.tokValSol*mul)).curve(d3.curveMonotoneX)).attr("fill","none").attr("stroke","#ffaa00").attr("stroke-width",1.5).attr("opacity",0.7);
    const gId="rb"+Math.random().toString(36).slice(2,6);
    const lg=defs.append("linearGradient").attr("id",gId).attr("x1",0).attr("y1",0).attr("x2",1).attr("y2",0);
    lg.append("stop").attr("offset","0%").attr("stop-color","#9945ff");lg.append("stop").attr("offset","33%").attr("stop-color","#14f195");lg.append("stop").attr("offset","66%").attr("stop-color","#00ff88");lg.append("stop").attr("offset","100%").attr("stop-color","#ffaa00");
    svg.append("path").datum(histData).attr("d",d3.line().x(d=>x(d.date)).y(d=>y(d.totalSol*mul)).curve(d3.curveMonotoneX)).attr("fill","none").attr("stroke",`url(#${gId})`).attr("stroke-width",2.5);
    histData.forEach((d,i)=>{if(i%3===0||i===histData.length-1)svg.append("circle").attr("cx",x(d.date)).attr("cy",y(d.totalSol*mul)).attr("r",2).attr("fill","#00ff88").attr("opacity",0.6);});
    [{c:"#9945ff",l:"SOL"},{c:"#ffaa00",l:"Tokens"},{c:"#00ff88",l:"Total"}].forEach((e,i)=>{svg.append("circle").attr("cx",M.l+i*70).attr("cy",M.t-10).attr("r",3).attr("fill",e.c);svg.append("text").attr("x",M.l+i*70+7).attr("y",M.t-7).attr("fill","#667788").attr("font-size",8).attr("font-weight",700).text(e.l);});
    const last=histData[histData.length-1];
    if(last){const lv=last.totalSol*mul;svg.append("text").attr("x",W-M.r-4).attr("y",y(lv)-6).attr("text-anchor","end").attr("fill","#00ff88").attr("font-size",9).attr("font-weight",800).text(yMode==="usd"?fUsd(lv):fmt(lv,2)+" SOL");}
  },[histData,solPrice,yMode]);
  return <svg ref={ref} width="100%" height={280} style={{overflow:"visible"}}/>;
}

// Token Detail Modal
function TokenModal({token,cb,solPrice,totalPortfolio,onClose}){
  const[pairs,setPairs]=useState([]);
  useEffect(()=>{if(token){dexPairs(token.mint).then(p=>setPairs(p));};},[token]);
  if(!token)return null;
  const mp=pairs[0];const price=mp?parseFloat(mp.priceUsd||0):token.priceUsd||0;const pNat=mp?parseFloat(mp.priceNative||0):token.priceNative||0;
  const c=cb?.[token.mint];const valUsd=token.balance*price;const valSol=pNat?token.balance*pNat:0;
  const allocPct=totalPortfolio>0?(valUsd/totalPortfolio)*100:0;
  const costBasisSol=c?(token.balance/(c.bought||1))*c.solSpent:0;const unrealizedSol=valSol-costBasisSol;
  const realizedSol=c?c.solReceived-((c.sold/(c.bought||1))*c.solSpent):0;
  const totalPnlSol=unrealizedSol+realizedSol;const totalPnlUsd=totalPnlSol*(solPrice||0);
  const pairAddr=mp?.pairAddress||token.pairAddress;const dxUrl=pairAddr?`https://www.dextools.io/app/solana/pair-explorer/${pairAddr}`:null;
  return(
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(20px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"linear-gradient(165deg,#0a1220,#0d1a2a 50%,#0a1018)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:18,width:"100%",maxWidth:800,maxHeight:"94vh",overflow:"auto",boxShadow:"0 40px 80px rgba(0,0,0,0.6)"}}>
        <div style={{padding:"20px 24px 0",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {token.imageUrl&&<img src={token.imageUrl} alt="" style={{width:40,height:40,borderRadius:10}} onError={e=>{e.target.style.display="none";}}/>}
            <div><h2 style={{margin:0,fontSize:22,fontWeight:900,color:"#e8edf5"}}>${token.symbol||"???"}</h2><div style={{fontSize:9,color:"#445566",fontFamily:"monospace"}}>{token.mint}</div></div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",color:"#667788",width:34,height:34,borderRadius:8,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>{"\u00D7"}</button>
        </div>
        {pairAddr&&(<div style={{margin:"12px 24px",borderRadius:12,overflow:"hidden",border:"1px solid rgba(255,255,255,0.04)"}}><iframe src={`https://dexscreener.com/solana/${pairAddr}?embed=1&theme=dark&trades=0&info=0`} style={{width:"100%",height:320,border:"none"}} title="Chart"/></div>)}
        {c&&(<div style={{margin:"10px 24px",padding:"12px 16px",borderRadius:12,background:totalPnlSol>=0?"linear-gradient(135deg,rgba(0,255,136,0.06),rgba(153,69,255,0.04))":"linear-gradient(135deg,rgba(255,68,102,0.06),rgba(153,69,255,0.04))",border:`1px solid ${totalPnlSol>=0?"rgba(0,255,136,0.12)":"rgba(255,68,102,0.12)"}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
            <span style={{fontSize:9,color:"#9977cc",textTransform:"uppercase",letterSpacing:1.5,fontWeight:700}}>Cost-Basis PnL</span>
            <span style={{fontSize:20,fontWeight:900,color:pCol(totalPnlSol)}}>{totalPnlSol>=0?"+":""}{fmt(totalPnlSol,4)} SOL</span>
            <span style={{fontSize:12,color:"#667788"}}>({totalPnlUsd>=0?"+":""}{fUsd(totalPnlUsd)})</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:6}}>
            <Stat l="SOL Spent" v={fmt(c.solSpent,4)+" SOL"} cl="#ff4466"/><Stat l="SOL Received" v={fmt(c.solReceived,4)+" SOL"} cl="#00ff88"/><Stat l="Bought" v={fmt(c.bought,2)} cl="#ffaa00"/><Stat l="Sold" v={fmt(c.sold,2)} cl="#7799ee"/>
          </div>
        </div>)}
        <div style={{padding:"8px 24px 16px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:6}}>
          {[{l:"Price",v:price<0.001?"$"+price.toExponential(2):fUsd(price)},{l:"Holdings",v:fmt(token.balance,token.balance<1?4:2)},{l:"Value",v:fUsd(valUsd),c:"#00ff88"},{l:"Value (SOL)",v:fmt(valSol,4)+" SOL",c:"#9945ff"},{l:"MCap",v:fUsd(mp?.marketCap||mp?.fdv||token.marketCap||0)},{l:"24h Vol",v:fUsd(mp?.volume?.h24||token.volume24h||0)},{l:"Liquidity",v:fUsd(mp?.liquidity?.usd||token.liquidity||0)}].map((s,i)=>(
            <div key={i} style={{background:"rgba(255,255,255,0.015)",border:"1px solid rgba(255,255,255,0.03)",borderRadius:8,padding:"8px 10px"}}><div style={{fontSize:7,color:"#556677",textTransform:"uppercase",letterSpacing:1,fontWeight:700,marginBottom:2}}>{s.l}</div><div style={{fontSize:12,fontWeight:800,color:s.c||"#c8d0e0"}}>{s.v}</div></div>))}
        </div>
        {dxUrl&&(<div style={{padding:"0 24px 18px",textAlign:"center"}}><a href={dxUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",background:"rgba(0,255,136,0.06)",border:"1px solid rgba(0,255,136,0.15)",color:"#00ff88",borderRadius:8,padding:"7px 16px",fontSize:10,fontWeight:700,textDecoration:"none",textTransform:"uppercase"}}>DexTools {"\u2192"}</a></div>)}
      </div>
    </div>);
}

// FIX #6: Helius PnL - ONLY shows tokens currently held, sorted by USD value, with MCap/Vol from DexScreener, proper $ticker + contract link
function PnlTokenList({cb,tokens,solPrice,onSelectToken}){
  const entries=useMemo(()=>{
    // ONLY tokens currently held in wallet (tokens array = current holdings)
    return tokens.map(token=>{
      const c=cb[token.mint];
      const pnlSol=c?tokenTotalPnl(c,token):0;
      const holdingVal=token.balance*(token.priceUsd||0);
      const holdingSol=token.balance*(token.priceNative||0);
      const dxUrl=token.dextoolsUrl||token.pairAddress?`https://www.dextools.io/app/solana/pair-explorer/${token.pairAddress}`:null;
      return{mint:token.mint,symbol:token.symbol||null,name:token.name||null,imageUrl:token.imageUrl,pnlSol,pnlUsd:pnlSol*(solPrice||0),buys:c?c.trades.filter(t=>t.type==="BUY").length:0,sells:c?c.trades.filter(t=>t.type==="SELL").length:0,marketCap:token.marketCap||0,volume24h:token.volume24h||0,holdingVal,holdingSol,token,dxUrl};
    }).sort((a,b)=>b.holdingSol-a.holdingSol);
  },[cb,tokens,solPrice]);
  if(!entries.length)return <div style={{padding:20,textAlign:"center",color:"#445566",fontSize:11}}>No tokens currently held</div>;
  return(
    <div style={{marginTop:8}}>
      {entries.map((e,i)=>(
        <div key={e.mint} onClick={()=>e.token&&onSelectToken(e.token)} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderBottom:"1px solid rgba(255,255,255,0.03)",cursor:"pointer",transition:"background 0.12s"}} onMouseEnter={ev=>{ev.currentTarget.style.background="rgba(153,69,255,0.05)";}} onMouseLeave={ev=>{ev.currentTarget.style.background="transparent";}}>
          <span style={{fontSize:12,color:"#9945ff",fontWeight:900,minWidth:24}}>#{i+1}</span>
          {e.imageUrl?<img src={e.imageUrl} alt="" style={{width:32,height:32,borderRadius:8}} onError={ev=>{ev.target.style.display="none";}}/>:<div style={{width:32,height:32,borderRadius:8,background:`hsl(${(e.mint.charCodeAt(0)*37)%360},45%,22%)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#fff"}}>{(e.symbol||"?")[0]}</div>}
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              <span style={{fontSize:13,fontWeight:800,color:"#e8edf5"}}>{e.name||e.symbol||"Unknown"}</span>
              {e.symbol&&<span style={{fontSize:10,color:"#9945ff",fontWeight:700}}>${e.symbol}</span>}
            </div>
            <div style={{fontSize:8,color:"#3a4a5a",fontFamily:"monospace",marginTop:2}}>
              {e.dxUrl?<a href={e.dxUrl} target="_blank" rel="noopener noreferrer" style={{color:"#44ddff",textDecoration:"none"}} onClick={ev=>ev.stopPropagation()}>{e.mint}</a>:<span>{e.mint}</span>}
            </div>
          </div>
          <div style={{textAlign:"right",minWidth:90}}>
            <div style={{fontSize:12,fontWeight:800,color:"#e8edf5"}}>{fUsd(e.holdingVal)}</div>
            <div style={{fontSize:9,color:"#778899"}}>{fmt(e.holdingSol,4)} SOL</div>
          </div>
          <div style={{textAlign:"right",minWidth:80}}>
            <div style={{fontSize:11,fontWeight:800,color:pCol(e.pnlSol)}}>{(e.pnlSol>=0?"+":"")+fmt(e.pnlSol,4)} SOL</div>
            <div style={{fontSize:8,color:"#556677"}}>{e.pnlUsd>=0?"+":""}{fUsd(e.pnlUsd)}</div>
          </div>
          <div style={{textAlign:"right",minWidth:70}}>
            <div style={{fontSize:9,color:"#778899"}}>{e.marketCap>0?fUsd(e.marketCap):"\u2014"}</div>
            <div style={{fontSize:7,color:"#556677",textTransform:"uppercase"}}>MCap</div>
          </div>
          <div style={{textAlign:"right",minWidth:60}}>
            <div style={{fontSize:9,color:"#778899"}}>{e.volume24h>0?fUsd(e.volume24h):"\u2014"}</div>
            <div style={{fontSize:7,color:"#556677",textTransform:"uppercase"}}>24h Vol</div>
          </div>
          <div style={{textAlign:"center",minWidth:40}}>
            <span style={{fontSize:9,color:"#00ff88",fontWeight:700}}>{e.buys}B</span><span style={{fontSize:8,color:"#334455"}}>/</span><span style={{fontSize:9,color:"#ff4466",fontWeight:700}}>{e.sells}S</span>
          </div>
        </div>
      ))}
    </div>);
}

function TickerScroll({tokens,solPrice}){
  const items=useMemo(()=>{const l=[{symbol:"SOL",price:solPrice||0,change:0}];tokens.forEach(t=>{if(t.symbol&&t.priceUsd>0)l.push({symbol:t.symbol,price:t.priceUsd,change:t.priceChange24h||0});});return[...l,...l];},[tokens,solPrice]);
  return(<div style={{overflow:"hidden",background:"rgba(8,14,25,0.8)",border:"1px solid rgba(255,255,255,0.03)",borderRadius:10,height:36,position:"relative"}}><div style={{display:"flex",gap:24,whiteSpace:"nowrap",animation:`tickerScroll ${items.length*3}s linear infinite`,padding:"8px 0"}}>{items.map((t,i)=>(<span key={i} style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:10,flexShrink:0}}><span style={{color:"#e8edf5",fontWeight:800}}>${t.symbol}</span><span style={{color:"#8899aa"}}>{t.price<0.001?"$"+t.price.toExponential(2):fUsd(t.price)}</span><span style={{color:pCol(t.change),fontWeight:700,fontSize:9}}>{t.change>0?"\u25B2":t.change<0?"\u25BC":""}{fmt(Math.abs(t.change),1)}%</span></span>))}</div></div>);
}

function Row({token,idx,cb,sp,onClick}){
  const val=token.balance*(token.priceUsd||0);const pct=token.priceChange24h||0;const c=cb?.[token.mint];
  const pnlSol=c?tokenTotalPnl(c,token):null;const pnlUsd=pnlSol!=null&&sp?pnlSol*sp:null;
  const spark=useRef(Array.from({length:18},(_,i)=>{const b=token.priceUsd||1;const t=b*(1-(pct/100)*(1-i/17));return t+t*(Math.random()-0.5)*0.03;}));
  return(
    <div onClick={onClick} style={{display:"grid",gridTemplateColumns:"28px 1.5fr 0.8fr 0.65fr 0.55fr 0.75fr 100px 0.7fr",alignItems:"center",padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.025)",cursor:"pointer",transition:"background 0.12s",background:idx%2===0?"transparent":"rgba(255,255,255,0.006)"}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(0,255,136,0.025)";}} onMouseLeave={e=>{e.currentTarget.style.background=idx%2===0?"transparent":"rgba(255,255,255,0.006)";}}>
      <div style={{fontSize:10,color:"#334455",fontWeight:800}}>{idx+1}</div>
      <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
        {token.imageUrl?<img src={token.imageUrl} alt="" style={{width:24,height:24,borderRadius:6,flexShrink:0}} onError={e=>{e.target.style.display="none";}}/>:<div style={{width:24,height:24,borderRadius:6,flexShrink:0,background:`hsl(${(token.mint.charCodeAt(0)*37)%360},45%,22%)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:"#fff"}}>{(token.symbol||"?")[0]}</div>}
        <div style={{minWidth:0}}><div style={{fontSize:11,fontWeight:700,color:"#d0d8e8",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{token.symbol?"$"+token.symbol:sAddr(token.mint)}</div><div style={{fontSize:7,color:"#3a4a5a",fontFamily:"monospace"}}>{sAddr(token.mint)}</div></div>
      </div>
      <div style={{fontSize:10,fontWeight:600,color:"#a0aab8"}}>{token.priceUsd?(token.priceUsd<0.001?"$"+token.priceUsd.toExponential(2):fUsd(token.priceUsd)):"\u2014"}</div>
      <div style={{fontSize:10,fontWeight:600,color:"#7888a0"}}>{fmt(token.balance,token.balance<1?4:2)}</div>
      <div style={{fontSize:9,fontWeight:800,color:pCol(pct)}}>{pct!==0?(pct>0?"+":"")+fmt(pct,1)+"%":"\u2014"}</div>
      <div style={{fontSize:9,fontWeight:800,color:pnlSol!=null?pCol(pnlSol):"#3a4a5a"}}>{pnlSol!=null?<><span>{(pnlSol>=0?"+":"")+fmt(pnlSol,3)} SOL</span>{pnlUsd!=null&&<div style={{fontSize:7,color:"#556677"}}>{fUsd(pnlUsd)}</div>}</>:"\u2014"}</div>
      <div style={{display:"flex",justifyContent:"center"}}><Spark data={spark.current} color={pCol(pct)}/></div>
      <div style={{fontSize:11,fontWeight:800,color:val>0?"#e0e8f0":"#3a4a5a",textAlign:"right"}}>{val>0?fUsd(val):"\u2014"}</div>
    </div>);
}

// ─── MAIN DASHBOARD ────────────────────────────────────
export default function Dashboard() {
  const [solBal,setSolBal]=useState(null);
  const [tokens,setTokens]=useState([]);
  const [loading,setLoading]=useState(true);
  const [err,setErr]=useState(null);
  const [selToken,setSelToken]=useState(null);
  const [sortBy,setSortBy]=useState('value');
  const [sortDir,setSortDir]=useState('desc');
  const [noise,setNoise]=useState('');
  const [solPrice,setSolPrice]=useState(null);
  const [cb,setCb]=useState({});
  const [pnlLoading,setPnlLoading]=useState(false);
  const [wsLive,setWsLive]=useState(false);
  const [gInput,setGInput]=useState('');
  const [gWallet,setGWallet]=useState(null);
  const [gData,setGData]=useState(null);
  const [gCb,setGCb]=useState(null);
  const [gLoading,setGLoading]=useState(false);
  const [showComp,setShowComp]=useState(false);
  const [aqSnap,setAqSnap]=useState(null);
  const [pnlOpen,setPnlOpen]=useState(false);
  const [hoveredCard,setHoveredCard]=useState(null);
  const [chartYMode,setChartYMode]=useState('sol');
  const [lastRefresh,setLastRefresh]=useState(null);

  useEffect(()=>{setNoise(mkNoise());},[]);

  // WebSocket + polling for SOL price
  useEffect(()=>{
    let ws,reconTimer,destroyed=false;
    const poll=async()=>{const p=await getSolPrice();if(p&&!destroyed){setSolPrice(p);}};
    const connectWs=()=>{
      if(destroyed)return;
      try{
        ws=new WebSocket('wss://api.mainnet-beta.solana.com');
        ws.onopen=()=>{if(destroyed)return;setWsLive(true);ws.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'accountSubscribe',params:['So11111111111111111111111111111111111111112',{encoding:'base64',commitment:'confirmed'}]}));};
        ws.onmessage=()=>{poll();};
        ws.onclose=()=>{if(!destroyed){setWsLive(false);reconTimer=setTimeout(connectWs,5000);}};
        ws.onerror=()=>{if(ws)ws.close();};
      }catch(e){reconTimer=setTimeout(connectWs,5000);}
    };
    poll();connectWs();
    const fb=setInterval(poll,20000);
    return()=>{destroyed=true;ws?.close();clearTimeout(reconTimer);clearInterval(fb);};
  },[]);

  // Initial wallet load
  const loadWallet=useCallback(async()=>{
    setLoading(true);setErr(null);
    try{
      const[bal,sp]=await Promise.all([getSolBalance(AQUATIC_WALLET),getSolPrice()]);
      setSolBal(bal);if(sp)setSolPrice(sp);
      const accs=await getTokenAccounts(AQUATIC_WALLET);
      console.log("[v7] Token accounts found:",accs.length,accs.map(a=>a.mint));
      const dx=await dexTokens(accs.map(a=>a.mint));
      console.log("[v7] DexScreener pairs found:",dx.length);
      const enriched=enrichTokens(accs,dx);
      console.log("[v7] Enriched tokens:",enriched.map(t=>({sym:t.symbol,mint:t.mint.slice(0,8),price:t.priceUsd,bal:t.balance})));
      setTokens(enriched);
      setAqSnap(buildSnapshot(enriched,bal,sp));
      setLastRefresh(Date.now());
    }catch(e){setErr(e.message);console.error("[v7] Load error:",e);}
    setLoading(false);
  },[]);
  useEffect(()=>{loadWallet();},[loadWallet]);

  // 5-minute full refresh: re-fetch token accounts + prices + SOL balance
  useEffect(()=>{
    const iv=setInterval(async()=>{
      try{
        console.log("[v7] 5-min refresh...");
        const[bal,sp]=await Promise.all([getSolBalance(AQUATIC_WALLET),getSolPrice()]);
        setSolBal(bal);if(sp)setSolPrice(sp);
        const accs=await getTokenAccounts(AQUATIC_WALLET);
        const dx=await dexTokens(accs.map(a=>a.mint));
        const enriched=enrichTokens(accs,dx);
        setTokens(enriched);
        setAqSnap(buildSnapshot(enriched,bal,sp));
        setLastRefresh(Date.now());
        console.log("[v7] Refreshed:",enriched.length,"tokens");
      }catch(e){console.warn("[v7] Refresh err:",e);}
    },5*60*1000);
    return()=>clearInterval(iv);
  },[]);

  const loadPnl=useCallback(async()=>{
    if(!HELIUS_KEY)return;
    setPnlLoading(true);
    try{
      const[swaps,transfers]=await Promise.all([fetchSwaps(AQUATIC_WALLET),fetchTransfers(AQUATIC_WALLET)]);
      setCb(buildCostBasis(swaps,transfers,AQUATIC_WALLET));
    }catch(e){console.warn('PnL err:',e);}
    setPnlLoading(false);
  },[]);
  useEffect(()=>{loadPnl();},[loadPnl]);

  const loadGuest=useCallback(async()=>{
    if(!gWallet)return;setGLoading(true);
    try{
      const[bal,sp]=await Promise.all([getSolBalance(gWallet),getSolPrice()]);
      const accs=await getTokenAccounts(gWallet);const dx=await dexTokens(accs.map(a=>a.mint));
      const enriched=enrichTokens(accs,dx);
      setGData(buildSnapshot(enriched,bal,sp));
      if(HELIUS_KEY){const[gs,gt]=await Promise.all([fetchSwaps(gWallet,4),fetchTransfers(gWallet,2)]);setGCb(buildCostBasis(gs,gt,gWallet));}
      setShowComp(true);
    }catch(e){console.warn('Guest err:',e);}
    setGLoading(false);
  },[gWallet]);
  useEffect(()=>{if(gWallet)loadGuest();},[loadGuest,gWallet]);

  const sorted=useMemo(()=>[...tokens].sort((a,b)=>{
    let va,vb;
    switch(sortBy){
      case'value':va=a.balance*(a.priceUsd||0);vb=b.balance*(b.priceUsd||0);break;
      case'balance':va=a.balance;vb=b.balance;break;
      case'change':va=a.priceChange24h||0;vb=b.priceChange24h||0;break;
      case'price':va=a.priceUsd||0;vb=b.priceUsd||0;break;
      case'pnl':va=cb[a.mint]?tokenTotalPnl(cb[a.mint],a):-Infinity;vb=cb[b.mint]?tokenTotalPnl(cb[b.mint],b):-Infinity;break;
      default:va=a.balance*(a.priceUsd||0);vb=b.balance*(b.priceUsd||0);
    }
    return sortDir==='desc'?vb-va:va-vb;
  }),[tokens,sortBy,sortDir,cb]);

  const tokVal=tokens.reduce((s,t)=>s+t.balance*(t.priceUsd||0),0);
  const solUsd=solBal!=null&&solPrice?solBal*solPrice:0;
  const total=tokVal+solUsd;
  const goalPct=solBal!=null?(solBal/10000)*100:0;
  const totalPnlSol=Object.values(cb).reduce((s,c)=>s+(c.solReceived-c.solSpent),0);
  const totalPnlUsd=totalPnlSol*(solPrice||0);
  const totalTrades=Object.values(cb).reduce((s,c)=>s+c.trades.length,0);

  // FIX #3: Win Rate = tokens with positive total PnL (realized+unrealized)
  const winningTokens=Object.entries(cb).filter(([mint,c])=>{const tok=tokens.find(t=>t.mint===mint);return tokenTotalPnl(c,tok)>0;}).length;
  const losingTokens=Object.keys(cb).length-winningTokens;
  const winRate=Object.keys(cb).length>0?(winningTokens/Object.keys(cb).length*100):0;
  const bestTrade=findBestTrade(cb,tokens);
  const totalSpent=Object.values(cb).reduce((s,c)=>s+c.solSpent,0);
  const totalReceived=Object.values(cb).reduce((s,c)=>s+c.solReceived,0);
  const pnlPct=totalSpent>0?((totalReceived-totalSpent)/totalSpent)*100:0;
  const histData=useMemo(()=>buildHistoricalData(cb,tokens,solBal||0,solPrice),[cb,tokens,solBal,solPrice]);
  const tokensByValue=useMemo(()=>[...tokens].sort((a,b)=>(b.balance*(b.priceUsd||0))-(a.balance*(a.priceUsd||0))),[tokens]);

  // FIX #1: Pie data with SOL + all held tokens
  const pie=useMemo(()=>{
    const items=[];
    if(solUsd>0)items.push({label:'SOL',value:solUsd,pct:total>0?(solUsd/total)*100:0});
    const s=[...tokens].sort((a,b)=>b.balance*(b.priceUsd||0)-a.balance*(a.priceUsd||0));
    let other=0;
    s.forEach((t,i)=>{const v=t.balance*(t.priceUsd||0);if(v<=0)return;if(i<7)items.push({label:t.symbol?"$"+t.symbol:sAddr(t.mint),value:v,pct:total>0?(v/total)*100:0});else other+=v;});
    if(other>0)items.push({label:'Other',value:other,pct:total>0?(other/total)*100:0});
    // If only SOL and no token data yet, still show SOL
    if(items.length===0&&solUsd>0)items.push({label:'SOL',value:solUsd,pct:100});
    return items.filter(d=>d.value>0);
  },[tokens,solUsd,total]);

  const doSort=k=>{if(sortBy===k)setSortDir(sortDir==='desc'?'asc':'desc');else{setSortBy(k);setSortDir('desc');}};
  const SI=({c})=>sortBy!==c?null:<span style={{marginLeft:2,fontSize:7}}>{sortDir==='desc'?'\u25BC':'\u25B2'}</span>;


  return (
    <div style={{minHeight:"100vh",position:"relative",overflow:"hidden"}}>
      <div style={{position:"fixed",inset:0,zIndex:0,background:"radial-gradient(ellipse at 15% 0%,rgba(153,69,255,0.05) 0%,transparent 50%),radial-gradient(ellipse at 85% 100%,rgba(0,255,136,0.03) 0%,transparent 50%)"}}/>
      {noise&&<div style={{position:"fixed",inset:0,zIndex:1,backgroundImage:`url(${noise})`,backgroundRepeat:"repeat",opacity:0.5,pointerEvents:"none"}}/>}
      <div style={{position:"relative",zIndex:2,maxWidth:1200,margin:"0 auto",padding:"0 20px"}}>

        <header style={{padding:"28px 0 0",marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:wsLive?"#00ff88":loading?"#ffaa00":"#556677",boxShadow:wsLive?"0 0 10px #00ff88":"none",animation:wsLive?"pulse 2.5s infinite":"none"}}/>
            <span style={{fontSize:9,color:"#556677",textTransform:"uppercase",letterSpacing:2,fontWeight:700}}>{wsLive?"Live":loading?"Syncing":"Connected"} {"\u00B7"} Solana Mainnet</span>
          </div>
          <div style={{display:"flex",alignItems:"flex-end",gap:12,flexWrap:"wrap"}}>
            <h1 style={{margin:0,fontSize:"clamp(26px,4.8vw,48px)",fontWeight:900,background:"linear-gradient(135deg,#e8edf5,#9945ff 25%,#14f195 55%,#00ff88 80%,#e8edf5)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:"-0.03em",lineHeight:1.08,flex:1}}>Aquatic&apos;s Retarded Attempt at 10,000 SOL 2026</h1>
            <a href="https://x.com/AquaticXCP" target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,background:"rgba(29,155,240,0.06)",border:"1px solid rgba(29,155,240,0.15)",color:"#1d9bf0",borderRadius:8,padding:"7px 12px",fontSize:10,fontWeight:700,textDecoration:"none",flexShrink:0}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              @AquaticXCP
            </a>
          </div>
          <div style={{fontFamily:"monospace",fontSize:13,color:"#556677",marginTop:8,padding:"6px 12px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)",borderRadius:7,display:"inline-block",userSelect:"all"}}>{AQUATIC_WALLET}</div>
          <div style={{marginTop:14,maxWidth:900}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:10,color:"#556677",textTransform:"uppercase",letterSpacing:1,fontWeight:700}}>Goal: 10,000 SOL</span>
              <span style={{fontSize:12,color:goalPct>=100?"#00ff88":"#9945ff",fontWeight:800}}>{solBal!=null?fmt(solBal,4):"..."} / 10K ({fmt(goalPct,2)}%)</span>
            </div>
            <div style={{height:8,background:"rgba(255,255,255,0.03)",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(goalPct,100)+"%",background:"linear-gradient(90deg,#9945ff,#14f195,#00ff88)",borderRadius:4,transition:"width 0.8s"}}/></div>
          </div>
        </header>

        {Object.keys(cb).length>0&&(
          <div style={{marginBottom:16,padding:"20px 24px",borderRadius:16,background:totalPnlSol>=0?"linear-gradient(135deg,rgba(0,255,136,0.04),rgba(153,69,255,0.03))":"linear-gradient(135deg,rgba(255,68,102,0.04),rgba(153,69,255,0.03))",border:`1px solid ${totalPnlSol>=0?"rgba(0,255,136,0.1)":"rgba(255,68,102,0.1)"}`}}>
            <div style={{fontSize:9,color:"#9977cc",textTransform:"uppercase",letterSpacing:2,fontWeight:700,marginBottom:6}}>Profit & Loss of Aquatic in the Trenches 2026</div>
            <div style={{display:"flex",alignItems:"baseline",gap:14,flexWrap:"wrap"}}>
              <span style={{fontSize:"clamp(28px,4vw,42px)",fontWeight:900,color:pCol(totalPnlSol)}}>{totalPnlSol>=0?"+":""}{fmt(totalPnlSol,4)} SOL</span>
              <span style={{fontSize:18,fontWeight:700,color:"#667788"}}>({totalPnlUsd>=0?"+":""}{fUsd(totalPnlUsd)})</span>
              <span style={{fontSize:16,fontWeight:800,color:pCol(pnlPct),background:pnlPct>=0?"rgba(0,255,136,0.06)":"rgba(255,68,102,0.06)",padding:"4px 10px",borderRadius:6}}>{pnlPct>=0?"+":""}{fmt(pnlPct,2)}%</span>
            </div>
            <div style={{marginTop:8,fontSize:10,color:"#556677"}}>Deployed: {fmt(totalSpent,2)} SOL {"\u00B7"} Returned: {fmt(totalReceived,2)} SOL {"\u00B7"} {totalTrades} trades across {Object.keys(cb).length} tokens {"\u00B7"} Win rate: {fmt(winRate,1)}% ({winningTokens}W / {losingTokens}L)</div>
          </div>
        )}

        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
          {[
            {l:"Total Portfolio",v:loading?"...":fUsd(total),c:"#e8edf5",g:"rgba(153,69,255,0.12)"},
            {l:"SOL Balance",v:solBal!=null?fmt(solBal,4)+" SOL":"...",s:solUsd>0?"\u2248 "+fUsd(solUsd):"",c:"#00ff88",g:"rgba(0,255,136,0.08)"},
            {l:"Token Value",v:loading?"...":fUsd(tokVal),s:tokens.length+" token"+(tokens.length!==1?"s":"")+" \u00B7 auto-refresh 5m",c:"#ffaa44",g:"rgba(255,170,0,0.08)"},
            {l:"SOL Price",v:solPrice?fUsd(solPrice):"...",s:wsLive?"Live \u25C9":"",c:"#7799ee",g:"rgba(100,150,255,0.08)"},
            {l:"Net PnL",v:Object.keys(cb).length>0?(totalPnlSol>=0?"+":"")+fmt(totalPnlSol,4)+" SOL":pnlLoading?"Loading...":"\u2014",s:Object.keys(cb).length>0?fUsd(totalPnlUsd):"",c:pCol(totalPnlSol),g:totalPnlSol>=0?"rgba(0,255,136,0.08)":"rgba(255,68,102,0.08)"},
            {l:"Win Rate",v:Object.keys(cb).length>0?fmt(winRate,1)+"%":"\u2014",s:winningTokens+"W / "+losingTokens+"L",c:winRate>=50?"#00ff88":"#ff4466",g:winRate>=50?"rgba(0,255,136,0.06)":"rgba(255,68,102,0.06)"},
            {l:"Best Trade",v:bestTrade?"+"+fmt(bestTrade.sol,4)+" SOL":"\u2014",s:bestTrade?.symbol?"$"+bestTrade.symbol:"",c:"#00ff88",g:"rgba(0,255,136,0.06)"},
            {l:"Total Trades",v:totalTrades>0?String(totalTrades):"\u2014",s:tokens.length+" held now",c:"#9945ff",g:"rgba(153,69,255,0.08)"},
          ].map((card,i)=>(
            <div key={i} onMouseEnter={()=>setHoveredCard(i)} onMouseLeave={()=>setHoveredCard(null)} style={{background:`linear-gradient(145deg,${card.g} 0%,rgba(10,18,32,0.95) 100%)`,border:`1px solid ${card.g}`,borderRadius:12,padding:"14px 16px",position:"relative",overflow:"hidden",transition:"transform 0.15s,box-shadow 0.15s",transform:hoveredCard===i?"translateY(-2px)":"none",boxShadow:hoveredCard===i?`0 8px 24px ${card.g}`:"none"}}>
              <CardParticles active={hoveredCard===i}/>
              <div style={{position:"relative",zIndex:2}}>
                <div style={{fontSize:8,color:"#556677",textTransform:"uppercase",letterSpacing:1.5,fontWeight:700,marginBottom:3}}>{card.l}</div>
                <div style={{fontSize:18,fontWeight:900,color:card.c,fontFeatureSettings:"'tnum'"}}>{card.v}</div>
                {card.s&&<div style={{fontSize:9,color:"#556677",marginTop:1}}>{card.s}</div>}
              </div>
            </div>
          ))}
        </div>

        {/* 3-PANEL: Pie + Portfolio Chart + PnL Dist */}
        <div style={{display:"grid",gridTemplateColumns:"280px 1fr 260px",gap:12,marginBottom:16}}>
          <div style={{background:"rgba(8,14,25,0.6)",border:"1px solid rgba(255,255,255,0.03)",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",padding:10}}>
            {pie.length>0?<Pie data={pie} size={258}/>:<div style={{color:"#334455",fontSize:11}}>Loading...</div>}
          </div>
          <div style={{background:"rgba(8,14,25,0.6)",border:"1px solid rgba(255,255,255,0.03)",borderRadius:14,padding:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:9,color:"#9977cc",textTransform:"uppercase",letterSpacing:1.5,fontWeight:700}}>Portfolio Value</div>
              <div style={{display:"flex",gap:4}}>
                {["sol","usd"].map(m=>(<button key={m} onClick={()=>setChartYMode(m)} style={{background:chartYMode===m?"rgba(0,255,136,0.1)":"rgba(255,255,255,0.02)",border:`1px solid ${chartYMode===m?"rgba(0,255,136,0.2)":"rgba(255,255,255,0.04)"}`,color:chartYMode===m?"#00ff88":"#556677",padding:"3px 8px",borderRadius:5,fontSize:9,fontWeight:700,cursor:"pointer",textTransform:"uppercase"}}>{m}</button>))}
              </div>
            </div>
            <PortfolioChart histData={histData} solPrice={solPrice} yMode={chartYMode}/>
          </div>
          <div style={{background:"rgba(8,14,25,0.6)",border:"1px solid rgba(255,255,255,0.03)",borderRadius:14,padding:14}}>
            <div style={{fontSize:9,color:"#9977cc",textTransform:"uppercase",letterSpacing:1.5,fontWeight:700,marginBottom:8}}>PnL Distribution</div>
            <PnlDistChart cb={cb} tokens={tokens}/>
          </div>
        </div>

        {/* HELIUS PNL - shows ONLY currently held tokens */}
        <div style={{marginBottom:16,borderRadius:14,background:"linear-gradient(135deg,rgba(153,69,255,0.05),rgba(0,255,136,0.03))",border:"1px solid rgba(153,69,255,0.1)",overflow:"hidden"}}>
          <div onClick={()=>setPnlOpen(!pnlOpen)} style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",cursor:"pointer",transition:"background 0.12s"}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(153,69,255,0.04)";}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
            <span style={{fontSize:10,color:"#9977cc",textTransform:"uppercase",letterSpacing:1.5,fontWeight:700}}>Helius PnL</span>
            <span style={{fontSize:11,color:"#556677"}}>{"\u00B7"}</span>
            <span style={{fontSize:13,color:"#c8d0e0",fontWeight:700}}>{tokens.length} token{tokens.length!==1?"s":""} held {pnlOpen?"\u25B4":"\u25BE"}</span>
            <span style={{fontSize:11,color:"#556677"}}>{"\u00B7"}</span>
            <span style={{fontSize:15,fontWeight:800,color:pCol(totalPnlSol)}}>net PnL: {totalPnlSol>=0?"+":""}{fmt(totalPnlSol,4)} SOL</span>
            <span style={{fontSize:12,color:"#667788"}}>({fUsd(totalPnlUsd)})</span>
            <span style={{fontSize:11,color:"#556677"}}>{"\u00B7"}</span>
            <span style={{fontSize:10,color:winRate>=50?"#00ff88":"#ff4466"}}>{fmt(winRate,0)}% WR ({winningTokens}W/{losingTokens}L)</span>
          </div>
          {pnlOpen&&<div style={{borderTop:"1px solid rgba(153,69,255,0.08)",padding:"0 8px 10px"}}><PnlTokenList cb={cb} tokens={tokens} solPrice={solPrice} onSelectToken={setSelToken}/></div>}
        </div>

        {/* TWO-COLUMN: Compare + Holdings */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:22}}>
          <div>
            <div style={{display:"flex",gap:6,marginBottom:12}}>
              <input value={gInput} onChange={e=>setGInput(e.target.value)} placeholder="Enter Solana wallet to compare..." style={{flex:1,background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,padding:"9px 12px",color:"#c8d0e0",fontSize:11,fontFamily:"monospace",outline:"none"}} onKeyDown={e=>{if(e.key==="Enter"&&gInput.length>=32)setGWallet(gInput.trim());}}/>
              <button onClick={()=>{if(gInput.length>=32)setGWallet(gInput.trim());}} disabled={gLoading||gInput.length<32} style={{background:gInput.length>=32?"rgba(255,170,0,0.1)":"rgba(255,255,255,0.02)",border:`1px solid ${gInput.length>=32?"rgba(255,170,0,0.2)":"rgba(255,255,255,0.06)"}`,color:gInput.length>=32?"#ffaa00":"#3a4a5a",borderRadius:8,padding:"9px 14px",fontSize:10,fontWeight:700,cursor:gInput.length>=32?"pointer":"not-allowed",textTransform:"uppercase",letterSpacing:1}}>{gLoading?"...":"\u2694 Compare"}</button>
            </div>

            {/* FIX #5: HOLDINGS - SOL + all tokens, sorted by value, 5-min refresh */}
            <div style={{background:"rgba(8,14,25,0.6)",border:"1px solid rgba(255,255,255,0.03)",borderRadius:14,overflow:"hidden"}}>
              <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.04)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:9,color:"#9977cc",textTransform:"uppercase",letterSpacing:1.5,fontWeight:700}}>Holdings ({tokens.length+1} assets)</span>
                {lastRefresh&&<span style={{fontSize:8,color:"#334455"}}>Updated {new Date(lastRefresh).toLocaleTimeString()}</span>}
              </div>
              <div style={{maxHeight:440,overflow:"auto"}}>
                {solBal!=null&&(
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.025)",background:"rgba(153,69,255,0.03)"}}>
                    <span style={{fontSize:9,color:"#9945ff",fontWeight:800,width:20}}>1</span>
                    <div style={{width:28,height:28,borderRadius:7,background:"linear-gradient(135deg,#9945ff,#14f195)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:"#fff"}}>S</div>
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:800,color:"#e8edf5"}}>$SOL</div><div style={{fontSize:9,color:"#556677"}}>Native {"\u00B7"} Solana</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:12,fontWeight:800,color:"#e8edf5"}}>{fmt(solBal,4)} SOL</div><div style={{fontSize:9,color:"#778899"}}>{fUsd(solUsd)}</div></div>
                  </div>
                )}
                {tokensByValue.map((t,i)=>{const val=t.balance*(t.priceUsd||0);const valSol=t.balance*(t.priceNative||0);return(
                  <div key={t.mint} onClick={()=>setSelToken(t)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderBottom:"1px solid rgba(255,255,255,0.02)",cursor:"pointer",transition:"background 0.1s"}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(0,255,136,0.02)";}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                    <span style={{fontSize:9,color:"#334455",fontWeight:800,width:20}}>{i+2}</span>
                    {t.imageUrl?<img src={t.imageUrl} alt="" style={{width:28,height:28,borderRadius:7}} onError={e=>{e.target.style.display="none";}}/>:<div style={{width:28,height:28,borderRadius:7,background:`hsl(${(t.mint.charCodeAt(0)*37)%360},45%,22%)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff"}}>{(t.symbol||"?")[0]}</div>}
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,color:"#d0d8e8"}}>{t.symbol?"$"+t.symbol:sAddr(t.mint)}</div><div style={{fontSize:7,color:"#3a4a5a",fontFamily:"monospace"}}>{sAddr(t.mint)}</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:11,fontWeight:800,color:val>0?"#e0e8f0":"#3a4a5a"}}>{val>0?fUsd(val):"$0"}</div><div style={{fontSize:8,color:"#556677"}}>{fmt(valSol,4)} SOL</div><div style={{fontSize:8,color:"#445566"}}>{fmt(t.balance,t.balance<1?4:2)} tokens</div></div>
                  </div>);})}
              </div>
            </div>
          </div>
          <div>
            <div style={{marginBottom:12}}><TickerScroll tokens={tokens} solPrice={solPrice}/></div>
            <div style={{marginTop:8,display:"flex",justifyContent:"flex-end",gap:8}}>
              <button onClick={loadWallet} disabled={loading} style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",color:loading?"#334455":"#778899",padding:"7px 14px",borderRadius:8,fontSize:10,fontWeight:700,cursor:loading?"not-allowed":"pointer",textTransform:"uppercase",letterSpacing:1}}>{loading?"Loading...":"\u27F3 Refresh"}</button>
            </div>
          </div>
        </div>

        {err&&<div style={{background:"rgba(255,68,102,0.06)",border:"1px solid rgba(255,68,102,0.15)",borderRadius:12,padding:"12px 16px",marginBottom:14,color:"#ff6688",fontSize:12}}><strong>Error:</strong> {err}</div>}

        {/* TOKEN TABLE */}
        <div style={{background:"rgba(8,14,25,0.7)",border:"1px solid rgba(255,255,255,0.03)",borderRadius:14,overflow:"hidden",boxShadow:"0 16px 48px rgba(0,0,0,0.25)",marginBottom:32}}>
          <div style={{display:"grid",gridTemplateColumns:"28px 1.5fr 0.8fr 0.65fr 0.55fr 0.75fr 100px 0.7fr",padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.05)",background:"rgba(255,255,255,0.012)"}}>
            {[{k:null,l:"#"},{k:null,l:"Token"},{k:"price",l:"Price"},{k:"balance",l:"Balance"},{k:"change",l:"24h"},{k:"pnl",l:"PnL"},{k:null,l:"Chart",s:{textAlign:"center"}},{k:"value",l:"Value",s:{textAlign:"right"}}].map((c,i)=>(
              <div key={i} onClick={c.k?()=>doSort(c.k):undefined} style={{fontSize:8,color:"#3a4a5a",textTransform:"uppercase",letterSpacing:1.2,fontWeight:800,cursor:c.k?"pointer":"default",...c.s}}>{c.l}{c.k&&<SI c={c.k}/>}</div>
            ))}
          </div>
          {loading&&!tokens.length&&<div style={{padding:"44px 16px",textAlign:"center"}}><div style={{width:32,height:32,border:"2px solid rgba(153,69,255,0.15)",borderTopColor:"#9945ff",borderRadius:"50%",margin:"0 auto 12px",animation:"spin 1s linear infinite"}}/><div style={{fontSize:11,color:"#445566"}}>Fetching from Solana + DexScreener + Helius...</div></div>}
          {sorted.map((t,i)=><Row key={t.mint} token={t} idx={i} cb={cb} sp={solPrice} onClick={()=>setSelToken(t)}/>)}
        </div>

        <footer style={{padding:"12px 0 32px",textAlign:"center",fontSize:9,color:"#2a3a4a"}}>
          <div>Helius Enhanced Transactions {"\u00B7"} DexScreener {"\u00B7"} DexTools {"\u00B7"} Solana RPC {"\u00B7"} Token-2022 Support</div>
          <div style={{fontFamily:"monospace",marginTop:3}}>v7 {"\u00B7"} Trenches Edition</div>
        </footer>
      </div>
      {selToken&&<TokenModal token={selToken} cb={cb} solPrice={solPrice} totalPortfolio={total} onClose={()=>setSelToken(null)}/>}
    </div>
  );

}
