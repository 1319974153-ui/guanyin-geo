/* Original canvas refraction and native tab keyboard behavior; no external resources. */
(() => {
  let dispose = () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function mount() {
    dispose();
    const surface = document.querySelector('[data-light-surface]');
    if (!surface) { dispose = () => {}; return; }
    const canvas = surface.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    let raf = 0, last = 0, visible = true, width = 0, height = 0, pointerX = 0, pointerY = 0;
    const lightTheme = document.documentElement.dataset.theme === 'light';
    function paint(time = 0) {
      ctx.clearRect(0,0,width,height);
      const phase = reduced.matches ? .6 : time * .00008;
      const cx = width * .66 + pointerX * 9, cy = height * .49 + pointerY * 8;
      const scale = Math.min(width / 460, height / 310);
      ctx.save();ctx.translate(cx,cy);ctx.rotate(-.36);
      const mist=ctx.createRadialGradient(0,0,0,0,0,180*scale);
      mist.addColorStop(0,lightTheme?'rgba(32,143,163,.10)':'rgba(45,160,197,.16)');mist.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=mist;ctx.fillRect(-220*scale,-220*scale,440*scale,440*scale);
      for(let ribbon=0;ribbon<44;ribbon++) {
        const offset=(ribbon-22)*1.6*scale;
        const gradient=ctx.createLinearGradient(-160*scale,-100*scale,160*scale,100*scale);
        const alpha=lightTheme?.19:.28;
        gradient.addColorStop(0,`rgba(105,135,243,${alpha*.15})`);
        gradient.addColorStop(.3,`rgba(122,160,228,${alpha})`);
        gradient.addColorStop(.56,`rgba(171,237,244,${alpha*1.8})`);
        gradient.addColorStop(.78,`rgba(74,173,189,${alpha})`);
        gradient.addColorStop(1,`rgba(105,135,243,${alpha*.1})`);
        ctx.strokeStyle=gradient;ctx.lineWidth=.8*scale;
        ctx.beginPath();
        for(let step=0;step<=150;step++) {
          const t=step/150*Math.PI*2;
          const x=Math.cos(t)*150*scale+Math.sin(t*2+phase)*12*scale;
          const y=Math.sin(t)*64*scale+Math.sin(t*2+phase*.7)*33*scale+offset*Math.sin(t);
          if(!step)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    function frame(time) {
      raf=0;
      if(document.hidden||!visible||reduced.matches)return;
      if(time-last>40){paint(time);last=time;}
      raf=requestAnimationFrame(frame);
    }
    function sync() {
      cancelAnimationFrame(raf);raf=0;
      paint(6000);
      if(!reduced.matches&&!document.hidden&&visible)raf=requestAnimationFrame(frame);
    }
    function resize() {
      const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;
      const dpr=Math.min(devicePixelRatio||1,1.5);
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);sync();
    }
    function move(e) {
      if(reduced.matches||e.pointerType==='touch')return;
      const r=surface.getBoundingClientRect();
      pointerX=(e.clientX-r.left)/r.width-.5;pointerY=(e.clientY-r.top)/r.height-.5;
      surface.style.setProperty('--light-x',`${e.clientX-r.left}px`);
      surface.style.setProperty('--light-y',`${e.clientY-r.top}px`);
    }
    const ro=new ResizeObserver(resize);ro.observe(canvas);
    const io=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();});io.observe(surface);
    surface.addEventListener('pointermove',move,{passive:true});
    document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
    dispose=()=>{cancelAnimationFrame(raf);ro.disconnect();io.disconnect();surface.removeEventListener('pointermove',move);document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);};
    resize();
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('#theme-toggle'))mount();
  });
  document.addEventListener('keydown',event=>{
    const tab=event.target.closest('.platform-tab');
    if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=[...tab.parentElement.querySelectorAll('.platform-tab')];
    let index=tabs.indexOf(tab);
    if(event.key==='Home')index=0;
    else if(event.key==='End')index=tabs.length-1;
    else index=(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    event.preventDefault();tabs[index].click();
  });
  window.GEO_LIGHT={mount};
})();
