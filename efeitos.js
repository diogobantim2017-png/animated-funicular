/*
  Efeitos visuais do painel, no mesmo estilo do portfólio da Digital Agency:
  - campo de filamentos de luz no fundo, com faíscas que correm pelos fios;
  - brilho que acompanha o cursor dentro das caixas;
  - abertura curta, uma vez por sessão.
  Tudo é decorativo e isolado: se algo falhar aqui, o painel continua funcionando.
*/
(() => {
  const reduzirMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let acelerar = 1;

  /* ------------------------------------------------ brilho nas caixas */
  try {
    const CAIXAS = '.bloco, .item, .config, .categoria, .percurso__passo';
    let pendente = null;
    document.addEventListener(
      'pointermove',
      (evento) => {
        const alvo = evento.target.closest?.(CAIXAS);
        if (!alvo) return;
        const agendar = !pendente;
        pendente = { alvo, x: evento.clientX, y: evento.clientY };
        if (!agendar) return;
        requestAnimationFrame(() => {
          const { alvo: caixa, x, y } = pendente;
          pendente = null;
          const r = caixa.getBoundingClientRect();
          caixa.style.setProperty('--mx', `${x - r.left}px`);
          caixa.style.setProperty('--my', `${y - r.top}px`);
        });
      },
      { passive: true },
    );
  } catch {
    /* efeito decorativo */
  }

  /* ------------------------------------------------ campo de filamentos */
  try {
    const canvas = document.getElementById('campo-de-luz');
    const ctx = canvas?.getContext('2d');
    if (ctx) {
      let largura = 0;
      let altura = 0;
      let fios = [];
      let faiscas = [];
      let tempo = 0;
      let ultimo = 0;

      const semear = () => {
        const estreito = innerWidth < 760;
        const total = estreito ? 16 : 26;
        fios = Array.from({ length: total }, (_, i) => ({
          base: 0.5 + (i / total) * 0.44,
          amp: 0.03 + Math.random() * 0.075,
          f1: 1.6 + Math.random() * 3.2,
          f2: 4 + Math.random() * 5.5,
          fase: Math.random() * Math.PI * 2,
          vel: 0.1 + Math.random() * 0.28,
          alfa: 0.03 + Math.random() * 0.08,
          destaque: Math.random() < 0.15,
        }));
        faiscas = Array.from({ length: estreito ? 4 : 9 }, () => ({
          fio: Math.floor(Math.random() * fios.length),
          x: Math.random(),
          v: 0.0005 + Math.random() * 0.0012,
        }));
      };

      const yNo = (fio, nx, t) =>
        altura * fio.base +
        Math.sin(nx * fio.f1 + t * fio.vel + fio.fase) * altura * fio.amp +
        Math.sin(nx * fio.f2 - t * fio.vel * 0.7 + fio.fase * 1.7) * altura * fio.amp * 0.32;

      const desenhar = (t) => {
        ctx.clearRect(0, 0, largura, altura);
        ctx.lineCap = 'round';
        for (const fio of fios) {
          ctx.beginPath();
          for (let x = 0; x <= largura + 10; x += 10) {
            const y = yNo(fio, x / largura, t);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          if (fio.destaque) {
            ctx.strokeStyle = `rgba(53, 210, 247, ${fio.alfa * 2.2})`;
            ctx.lineWidth = 1.4;
            ctx.shadowColor = 'rgba(18, 171, 219, 0.6)';
            ctx.shadowBlur = 8;
          } else {
            ctx.strokeStyle = `rgba(120, 190, 235, ${fio.alfa})`;
            ctx.lineWidth = 0.8;
            ctx.shadowBlur = 0;
          }
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        for (const faisca of faiscas) {
          const fio = fios[faisca.fio];
          const px = faisca.x * largura;
          const py = yNo(fio, faisca.x, t);
          // Rastro que desvanece atrás da faísca.
          ctx.beginPath();
          for (let k = 0; k < 16; k++) {
            const nx = faisca.x - k * 0.004;
            if (nx < 0) break;
            const y = yNo(fio, nx, t);
            if (k === 0) ctx.moveTo(nx * largura, y);
            else ctx.lineTo(nx * largura, y);
          }
          ctx.strokeStyle = 'rgba(120, 220, 255, 0.4)';
          ctx.lineWidth = 1.6;
          ctx.stroke();
          const brilho = ctx.createRadialGradient(px, py, 0, px, py, 24);
          brilho.addColorStop(0, 'rgba(160, 235, 255, 0.55)');
          brilho.addColorStop(1, 'rgba(18, 171, 219, 0)');
          ctx.fillStyle = brilho;
          ctx.beginPath();
          ctx.arc(px, py, 24, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      const redimensionar = () => {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        largura = innerWidth;
        altura = innerHeight;
        canvas.width = Math.round(largura * dpr);
        canvas.height = Math.round(altura * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        semear();
        desenhar(tempo);
      };

      // Cerca de 30 quadros por segundo bastam para o movimento lento e poupam bateria.
      const quadro = (agora) => {
        requestAnimationFrame(quadro);
        if (document.hidden || agora - ultimo < 32) return;
        const passo = Math.min(0.06, (agora - ultimo) / 1000);
        ultimo = agora;
        tempo += passo * acelerar;
        for (const faisca of faiscas) {
          faisca.x += faisca.v * acelerar;
          if (faisca.x > 1) {
            faisca.x = 0;
            faisca.fio = Math.floor(Math.random() * fios.length);
          }
        }
        desenhar(tempo);
      };

      redimensionar();
      addEventListener('resize', redimensionar);
      if (!reduzirMovimento) requestAnimationFrame(quadro);
    }
  } catch {
    /* efeito decorativo */
  }

  /* ------------------------------------------------ abertura */
  try {
    const abertura = document.getElementById('abertura');
    let jaViu = false;
    try {
      jaViu = sessionStorage.getItem('abertura-vista') === '1';
      sessionStorage.setItem('abertura-vista', '1');
    } catch {
      jaViu = true;
    }
    if (abertura && !reduzirMovimento && !jaViu) {
      abertura.hidden = false;
      acelerar = 2.2;
      setTimeout(() => {
        abertura.classList.add('abertura--saindo');
        acelerar = 1;
      }, 1500);
      setTimeout(() => {
        abertura.hidden = true;
      }, 2200);
    }
  } catch {
    /* efeito decorativo */
  }
})();
