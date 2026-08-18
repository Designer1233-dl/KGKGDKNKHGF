const TAU = Math.PI * 2;

export class NeonRaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.animationFrame = null;
    this.scene = null;
    this.startTime = 0;
  }

  renderIdle() {
    this.stop();
    this.scene = null;
    this.drawBackdrop();
    this.drawFrame();
    this.drawText("Race preview", 540, 290, 42, "#52f2ff");
    this.drawText("Здесь появится финальная анимация розыгрыша", 540, 340, 22, "#97a9bf");
  }

  play(scene) {
    this.stop();
    this.scene = this.prepareScene(scene);
    this.startTime = performance.now();
    this.loop = this.loop.bind(this);
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  stop() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  prepareScene(scene) {
    return {
      ...scene,
      racers: scene.racers.map((racer) => ({
        ...racer,
        x: 110 + (racer.seed % 120),
        y: 72,
        trail: [],
      })),
    };
  }

  loop(now) {
    if (!this.scene) {
      return;
    }

    const elapsed = now - this.startTime;
    this.drawBackdrop();
    this.drawGrid();
    this.drawObstacles(this.scene.obstacles);
    this.drawFinishLine();

    for (const racer of this.scene.racers) {
      this.updateRacer(racer, elapsed);
      this.drawTrail(racer);
      this.drawRacer(racer);
    }

    this.drawFrame();
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  updateRacer(racer, elapsed) {
    const progress = Math.min(1, elapsed / racer.duration);
    const wobble = Math.sin(progress * 14 + racer.seed) * 18;
    const laneJitter = Math.cos(progress * 9 + racer.seed / 10) * 10;

    racer.x =
      180 +
      Math.sin(progress * 6 + racer.seed * 0.001) * 120 +
      wobble +
      (racer.lane % 2 === 0 ? -26 : 26) +
      laneJitter;
    racer.y = 70 + easeInOutExpo(progress) * 520;

    racer.trail.push({ x: racer.x, y: racer.y });
    if (racer.trail.length > 12) {
      racer.trail.shift();
    }
  }

  drawBackdrop() {
    const { ctx, canvas } = this;
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#05101b");
    grad.addColorStop(1, "#07192b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const glowA = ctx.createRadialGradient(180, 120, 20, 180, 120, 200);
    glowA.addColorStop(0, "rgba(82,242,255,0.18)");
    glowA.addColorStop(1, "rgba(82,242,255,0)");
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const glowB = ctx.createRadialGradient(860, 120, 20, 860, 120, 220);
    glowB.addColorStop(0, "rgba(255,79,216,0.16)");
    glowB.addColorStop(1, "rgba(255,79,216,0)");
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawGrid() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.strokeStyle = "rgba(82,242,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawObstacles(obstacles) {
    const { ctx } = this;
    ctx.save();
    for (const peg of obstacles) {
      const grad = ctx.createRadialGradient(peg.x, peg.y, 2, peg.x, peg.y, peg.r * 1.8);
      grad.addColorStop(0, "rgba(255,255,255,0.95)");
      grad.addColorStop(1, "rgba(82,242,255,0.18)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFinishLine() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    for (let x = 40; x < canvas.width - 40; x += 40) {
      ctx.fillRect(x, 618, 20, 14);
    }
    ctx.restore();
  }

  drawTrail(racer) {
    const { ctx } = this;
    if (racer.trail.length < 2) {
      return;
    }

    ctx.save();
    for (let index = 0; index < racer.trail.length; index += 1) {
      const point = racer.trail[index];
      const alpha = (index + 1) / racer.trail.length / 2.5;
      ctx.fillStyle = hexToRgba(racer.color, alpha);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 7 + index * 0.22, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawRacer(racer) {
    const { ctx } = this;
    ctx.save();
    ctx.shadowColor = racer.color;
    ctx.shadowBlur = 26;
    ctx.fillStyle = racer.color;
    ctx.beginPath();
    ctx.arc(racer.x, racer.y, 19, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 12px Manrope";
    ctx.textAlign = "center";
    ctx.fillText(initials(racer.displayName), racer.x, racer.y + 4);

    ctx.font = "600 13px Manrope";
    ctx.fillStyle = "#eef7ff";
    ctx.fillText(racer.displayName.slice(0, 12), racer.x, racer.y - 32);
    ctx.restore();
  }

  drawFrame() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    ctx.restore();
  }

  drawText(text, x, y, size, color) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.font = `700 ${size}px Orbitron, sans-serif`;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

function easeInOutExpo(value) {
  if (value === 0 || value === 1) {
    return value;
  }
  if (value < 0.5) {
    return Math.pow(2, 20 * value - 10) / 2;
  }
  return (2 - Math.pow(2, -20 * value + 10)) / 2;
}

function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
