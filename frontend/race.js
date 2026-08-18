const TAU = Math.PI * 2;

export class NeonRaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.animationFrame = null;
    this.scene = null;
    this.startTime = 0;
    this.compactMode = false;
    this.phoneMode = false;
  }

  renderIdle() {
    this.stop();
    this.scene = null;
    this.resizeCanvas();
    this.drawBackdrop(0);
    this.drawGlassFrame();
    this.drawHeadline("Race preview", this.canvas.width / 2, this.canvas.height / 2 - 18, 46, "#52f2ff");
    this.drawSupportText("Здесь появится финальная гонка шаров", this.canvas.width / 2, this.canvas.height / 2 + 28, 24, "#97a9bf");
  }

  play(scene) {
    this.stop();
    this.resizeCanvas();
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

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    const viewportWidth = Math.round(parent?.clientWidth || window.innerWidth || 1080);
    const viewportHeight = Math.round(parent?.clientHeight || window.innerHeight || 720);
    const width = Math.max(320, viewportWidth);
    const height = Math.max(
      420,
      Math.min(viewportHeight, width < 760 ? Math.round((window.innerHeight || 760) * 0.72) : viewportHeight)
    );
    this.compactMode = width < 900;
    this.phoneMode = width < 640;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  prepareScene(scene) {
    const world = {
      width: scene.world?.width || 1080,
      height: scene.world?.height || 3200,
      finishY: scene.world?.finishY || 2700,
    };

    return {
      ...scene,
      world,
      cameraY: 0,
      racers: scene.racers.map((racer, index) => {
        const seedPhase = (racer.seed % 1000) / 1000;
        return {
          ...racer,
          x: 160 + ((racer.seed % 700) / 700) * 760,
          y: -180 - index * 36,
          vx: 0,
          vy: 0,
          rotation: 0,
          trail: [],
          pathPoints: createPathPoints(racer, world),
          laneBias: (index % 2 === 0 ? -1 : 1) * (30 + (index % 4) * 14),
          phase: seedPhase * TAU,
        };
      }),
    };
  }

  loop(now) {
    if (!this.scene) {
      return;
    }

    this.resizeCanvas();
    const elapsed = now - this.startTime;
    const leaderY = this.updateRacers(elapsed);
    this.scene.cameraY = clamp(
      leaderY - this.canvas.height * 0.34,
      0,
      Math.max(0, this.scene.world.finishY - this.canvas.height * 0.7)
    );

    this.drawBackdrop(this.scene.cameraY);
    this.drawDepthLights(this.scene.cameraY);
    this.drawCourse(this.scene.cameraY);
    this.drawObstacles(this.scene.obstacles, this.scene.cameraY);
    this.drawFinishZone(this.scene.cameraY);

    for (const racer of [...this.scene.racers].sort((a, b) => a.y - b.y)) {
      this.drawTrail(racer, this.scene.cameraY);
    }

    for (const racer of [...this.scene.racers].sort((a, b) => a.y - b.y)) {
      this.drawRacer(racer, this.scene.cameraY);
    }

    this.drawHud(elapsed);
    this.drawGlassFrame();
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  updateRacers(elapsed) {
    let leaderY = 0;

    for (const racer of this.scene.racers) {
      const progress = Math.min(1, elapsed / racer.duration);
      const eased = easeOutQuart(progress);
      const gravityBoost = 1 + Math.sin(progress * 5 + racer.phase) * 0.05;
      const baseY = -120 + eased * this.scene.world.finishY * gravityBoost;

      let targetX = pathXAtProgress(racer, progress);
      targetX += Math.sin(progress * 11 + racer.phase) * 16;
      targetX += Math.cos(progress * 19 + racer.phase * 0.72) * 9;
      targetX += racer.laneBias * (1 - progress) * 0.11;

      racer.vx += (targetX - racer.x) * 0.032;
      racer.vx *= 0.92;
      racer.x += racer.vx;

      const targetVy = baseY - racer.y;
      racer.vy += targetVy * 0.072;
      racer.vy *= 0.9;
      racer.y += racer.vy;

      applyObstacleInfluence(racer, this.scene.obstacles);

      racer.x = clamp(racer.x, 72, this.scene.world.width - 72);
      racer.y = Math.min(racer.y, this.scene.world.finishY);
      racer.rotation = clamp(racer.vx * 0.035, -0.32, 0.32);

      racer.trail.push({ x: racer.x, y: racer.y, size: racer.size || 19 });
      if (racer.trail.length > (this.phoneMode ? 8 : this.compactMode ? 12 : 22)) {
        racer.trail.shift();
      }

      leaderY = Math.max(leaderY, racer.y);
    }

    return leaderY;
  }

  drawBackdrop(cameraY) {
    const { ctx, canvas } = this;
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#020914");
    grad.addColorStop(0.5, "#071528");
    grad.addColorStop(1, "#030913");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const drift = cameraY * 0.08;
    const glowA = ctx.createRadialGradient(canvas.width * 0.18, 120 - drift, 10, canvas.width * 0.18, 120 - drift, 320);
    glowA.addColorStop(0, "rgba(82,242,255,0.22)");
    glowA.addColorStop(1, "rgba(82,242,255,0)");
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const glowB = ctx.createRadialGradient(canvas.width * 0.82, 180 - drift * 0.5, 10, canvas.width * 0.82, 180 - drift * 0.5, 360);
    glowB.addColorStop(0, "rgba(255,79,216,0.18)");
    glowB.addColorStop(1, "rgba(255,79,216,0)");
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawDepthLights(cameraY) {
    const { ctx, canvas } = this;
    ctx.save();
    const count = this.phoneMode ? 6 : this.compactMode ? 9 : 14;
    for (let index = 0; index < count; index += 1) {
      const y = ((index * 140 - cameraY * 0.65) % (canvas.height + 240)) - 120;
      ctx.fillStyle = `rgba(255,255,255,${0.025 + (index % 3) * 0.015})`;
      ctx.fillRect(44, y, canvas.width - 88, 2);
    }
    ctx.restore();
  }

  drawCourse(cameraY) {
    const { ctx, canvas } = this;
    ctx.save();

    const wallGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    wallGradient.addColorStop(0, "rgba(82,242,255,0.28)");
    wallGradient.addColorStop(0.5, "rgba(255,255,255,0.04)");
    wallGradient.addColorStop(1, "rgba(255,79,216,0.28)");
    ctx.strokeStyle = wallGradient;
    ctx.lineWidth = 4;
    ctx.strokeRect(48, 28, canvas.width - 96, canvas.height - 56);

    ctx.strokeStyle = "rgba(82,242,255,0.08)";
    ctx.lineWidth = 1;
    for (let x = 96; x < canvas.width - 70; x += this.phoneMode ? 168 : this.compactMode ? 144 : 118) {
      ctx.beginPath();
      ctx.moveTo(x, 24);
      ctx.lineTo(x, canvas.height - 24);
      ctx.stroke();
    }

    for (let offset = -2; offset <= 16; offset += 1) {
      const worldY = Math.floor(cameraY / 120) * 120 + offset * 120;
      const screenY = worldY - cameraY;
      if (screenY < -90 || screenY > canvas.height + 90) {
        continue;
      }
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(64, screenY);
      ctx.lineTo(canvas.width - 64, screenY);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawObstacles(obstacles, cameraY) {
    const { ctx, canvas } = this;
    ctx.save();

    for (const obstacle of obstacles) {
      const y = obstacle.y - cameraY;
      if (y < -140 || y > canvas.height + 140) {
        continue;
      }

      if (this.phoneMode && obstacle.kind === "peg" && obstacle.r < 16) {
        continue;
      }

      if (obstacle.kind === "bumper") {
        const grad = ctx.createRadialGradient(obstacle.x, y, 4, obstacle.x, y, obstacle.r * 2.2);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(0.36, "rgba(255,213,111,0.95)");
        grad.addColorStop(1, "rgba(255,213,111,0.14)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(obstacle.x, y, obstacle.r, 0, TAU);
        ctx.fill();
      } else if (obstacle.kind === "spinner") {
        ctx.strokeStyle = "rgba(255,79,216,0.86)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(obstacle.x - obstacle.r, y - obstacle.r * 0.7);
        ctx.lineTo(obstacle.x + obstacle.r, y + obstacle.r * 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(obstacle.x - obstacle.r, y + obstacle.r * 0.7);
        ctx.lineTo(obstacle.x + obstacle.r, y - obstacle.r * 0.7);
        ctx.stroke();
      } else {
        const grad = ctx.createRadialGradient(obstacle.x, y, 2, obstacle.x, y, obstacle.r * 1.8);
        grad.addColorStop(0, "rgba(255,255,255,0.98)");
        grad.addColorStop(1, "rgba(82,242,255,0.2)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(obstacle.x, y, obstacle.r, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  drawFinishZone(cameraY) {
    const { ctx, canvas } = this;
    const finishY = this.scene.world.finishY - cameraY;
    if (finishY > canvas.height + 80 || finishY < -120) {
      return;
    }

    ctx.save();
    const glow = ctx.createLinearGradient(0, finishY - 80, 0, finishY + 50);
    glow.addColorStop(0, "rgba(255,213,111,0)");
    glow.addColorStop(1, "rgba(255,213,111,0.22)");
    ctx.fillStyle = glow;
    ctx.fillRect(58, finishY - 80, canvas.width - 116, 130);

    for (let x = 60; x < canvas.width - 60; x += 34) {
      ctx.fillStyle = Math.floor((x - 60) / 34) % 2 === 0 ? "#ffffff" : "#0b1524";
      ctx.fillRect(x, finishY, 17, 26);
    }

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "700 24px Orbitron, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("FINISH", canvas.width / 2, finishY - 18);
    ctx.restore();
  }

  drawTrail(racer, cameraY) {
    const { ctx } = this;
    if (racer.trail.length < 2) {
      return;
    }

    ctx.save();
    for (let index = 0; index < racer.trail.length; index += 1) {
      const point = racer.trail[index];
      const alpha = ((index + 1) / racer.trail.length) * 0.35;
      const screenY = point.y - cameraY;
      ctx.fillStyle = hexToRgba(racer.color, alpha);
      ctx.beginPath();
      ctx.arc(point.x, screenY, 4 + index * 0.34, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawRacer(racer, cameraY) {
    const { ctx, canvas } = this;
    const screenY = racer.y - cameraY;
    if (screenY < -140 || screenY > canvas.height + 140) {
      return;
    }

    ctx.save();
    ctx.translate(racer.x, screenY);
    ctx.rotate(racer.rotation);
    ctx.shadowColor = racer.color;
    ctx.shadowBlur = this.phoneMode ? 18 : this.compactMode ? 24 : 36;

    const grad = ctx.createRadialGradient(-5, -6, 3, 0, 0, racer.size + 8);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.32, racer.color);
    grad.addColorStop(1, darkenHex(racer.color, 0.26));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, racer.size || 19, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, (racer.size || 19) - 1, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = "#04111e";
    ctx.font = this.phoneMode ? "700 9px Manrope, sans-serif" : "700 11px Manrope, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(initials(racer.displayName), 0, 4);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    const label = cropName(racer.usernameLabel || racer.displayName, this.phoneMode ? 10 : 16);
    const labelWidth = Math.max(56, label.length * (this.phoneMode ? 7 : 8) + 18);
    ctx.fillStyle = "rgba(4,17,30,0.72)";
    roundRect(ctx, racer.x - labelWidth / 2, screenY - 50, labelWidth, 20, 10);
    ctx.fill();
    ctx.font = this.phoneMode ? "700 11px Manrope, sans-serif" : "700 14px Manrope, sans-serif";
    ctx.fillStyle = "#eef7ff";
    ctx.fillText(label, racer.x, screenY - 36);
    if (!this.phoneMode) {
      ctx.font = this.compactMode ? "600 10px Manrope, sans-serif" : "600 11px Manrope, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.fillText(`+${racer.referralBonus || 0} chance`, racer.x, screenY - 18);
    }
    ctx.restore();
  }

  drawHud(elapsed) {
    const { ctx, canvas } = this;
    const leader = [...this.scene.racers].sort((a, b) => b.y - a.y)[0];
    const progress = leader ? Math.min(100, Math.round((leader.y / this.scene.world.finishY) * 100)) : 0;

    ctx.save();
    const panelGradient = ctx.createLinearGradient(28, 20, 420, 140);
    panelGradient.addColorStop(0, "rgba(4,16,28,0.94)");
    panelGradient.addColorStop(1, "rgba(10,29,48,0.82)");
    ctx.fillStyle = panelGradient;
    roundRect(ctx, 24, 18, 394, 118, 26);
    ctx.fill();
    ctx.strokeStyle = "rgba(82,242,255,0.18)";
    ctx.stroke();

    ctx.fillStyle = "#52f2ff";
    ctx.font = "700 14px Orbitron, sans-serif";
    ctx.fillText("LIVE DROP", 54, 44);

    ctx.fillStyle = "#eef7ff";
    ctx.font = "700 24px Orbitron, sans-serif";
    ctx.fillText(this.scene.title || "Raffle", 54, 80);

    if (leader) {
      ctx.font = "600 13px Manrope, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.84)";
      ctx.fillText(`Лидер: ${cropName(leader.usernameLabel || leader.displayName, 24)}`, 54, 108);
    }

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, canvas.width - 322, 28, 264, 20, 11);
    ctx.fill();

    const fill = ctx.createLinearGradient(canvas.width - 322, 28, canvas.width - 58, 28);
    fill.addColorStop(0, "#52f2ff");
    fill.addColorStop(1, "#ffd56f");
    ctx.fillStyle = fill;
    roundRect(ctx, canvas.width - 322, 28, Math.max(20, progress * 2.64), 20, 11);
    ctx.fill();

    ctx.fillStyle = "#eef7ff";
    ctx.font = "700 14px Manrope, sans-serif";
    ctx.fillText(`${progress}% до финиша`, canvas.width - 320, 72);
    ctx.fillText(`${Math.ceil(elapsed / 1000)}s`, canvas.width - 130, 72);
    ctx.restore();
  }

  drawGlassFrame() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    ctx.restore();
  }

  drawHeadline(text, x, y, size, color) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.font = `700 ${size}px Orbitron, sans-serif`;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  drawSupportText(text, x, y, size, color) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.font = `600 ${size}px Manrope, sans-serif`;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

function createPathPoints(racer, world) {
  const points = [];
  const steps = 12;
  const width = world.width - 180;

  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const swing = Math.sin(ratio * 8 + racer.seed * 0.0007) * (120 - ratio * 54);
    const noise = Math.cos(ratio * 15 + racer.seed * 0.0004) * 38;
    const base = 90 + ((racer.seed + index * 131) % 1000) / 1000 * width;
    points.push({
      progress: ratio,
      x: clamp(base + swing + noise, 92, world.width - 92),
    });
  }

  if (racer.isWinner) {
    points[points.length - 1].x = 540 + (racer.finishPlace - 1) * 62 - 62;
  }

  return points.sort((a, b) => a.progress - b.progress);
}

function pathXAtProgress(racer, progress) {
  const points = racer.pathPoints;
  for (let index = 1; index < points.length; index += 1) {
    if (progress <= points[index].progress) {
      const previous = points[index - 1];
      const next = points[index];
      const range = next.progress - previous.progress || 1;
      const local = (progress - previous.progress) / range;
      return lerp(previous.x, next.x, easeInOutSine(local));
    }
  }
  return points[points.length - 1].x;
}

function applyObstacleInfluence(racer, obstacles) {
  for (const obstacle of obstacles) {
    const dx = racer.x - obstacle.x;
    const dy = racer.y - obstacle.y;
    const distance = Math.hypot(dx, dy);
    const radius = obstacle.r + (racer.size || 18) + 14;

    if (distance < radius) {
      const force = (radius - distance) / radius;
      const direction = dx === 0 ? 1 : dx / Math.abs(dx);
      const kicker =
        obstacle.kind === "spinner" ? 18 :
        obstacle.kind === "bumper" ? 28 :
        12;

      racer.x += direction * kicker * force + (obstacle.drift || 0) * 0.08;
      racer.vx += direction * kicker * 0.15;
      racer.vy *= obstacle.kind === "bumper" ? 0.95 : 0.98;
    }
  }
}

function easeOutQuart(value) {
  return 1 - Math.pow(1 - value, 4);
}

function easeInOutSine(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function initials(name) {
  return String(name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function cropName(value, limit) {
  const text = String(value || "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1)}…`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function darkenHex(hex, amount) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  const r = Math.max(0, Math.round(((bigint >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.round(((bigint >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.round((bigint & 255) * (1 - amount)));
  return `rgb(${r}, ${g}, ${b})`;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
