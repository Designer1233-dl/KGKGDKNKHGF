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
    this.drawBackdrop(0);
    this.drawGlassFrame();
    this.drawHeadline("Race preview", 540, 292, 42, "#52f2ff");
    this.drawSupportText("Здесь появится финальная гонка шаров", 540, 336, 22, "#97a9bf");
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
    const world = {
      width: scene.world?.width || 1080,
      height: scene.world?.height || 2600,
      finishY: scene.world?.finishY || 2320,
    };

    return {
      ...scene,
      world,
      cameraY: 0,
      racers: scene.racers.map((racer, index) => {
        const seedPhase = (racer.seed % 1000) / 1000;
        return {
          ...racer,
          x: 150 + ((racer.seed % 700) / 700) * 780,
          y: 86,
          vx: 0,
          vy: 0,
          rotation: 0,
          trail: [],
          pathPoints: createPathPoints(racer, world),
          laneBias: (index % 2 === 0 ? -1 : 1) * (40 + (index % 3) * 18),
          phase: seedPhase * TAU,
          lastObstacleHit: -1,
        };
      }),
    };
  }

  loop(now) {
    if (!this.scene) {
      return;
    }

    const elapsed = now - this.startTime;
    const leaderY = this.updateRacers(elapsed);
    this.scene.cameraY = clamp(leaderY - this.canvas.height * 0.38, 0, this.scene.world.finishY - 520);

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
      const eased = easeInOutCubic(progress);
      const baseY = 90 + eased * (this.scene.world.finishY - 160);

      let targetX = pathXAtProgress(racer, progress);
      targetX += Math.sin(progress * 10 + racer.phase) * 12;
      targetX += Math.cos(progress * 17 + racer.phase * 0.7) * 6;
      targetX += racer.laneBias * (1 - progress) * 0.08;

      racer.vx += (targetX - racer.x) * 0.028;
      racer.vx *= 0.91;
      racer.x += racer.vx;

      const targetVy = baseY - racer.y;
      racer.vy += targetVy * 0.065;
      racer.vy *= 0.89;
      racer.y += racer.vy;

      applyObstacleInfluence(racer, this.scene.obstacles);

      racer.x = clamp(racer.x, 70, this.scene.world.width - 70);
      racer.y = Math.min(racer.y, this.scene.world.finishY);
      racer.rotation = clamp(racer.vx * 0.03, -0.28, 0.28);

      racer.trail.push({ x: racer.x, y: racer.y, r: racer.size || 18 });
      if (racer.trail.length > 18) {
        racer.trail.shift();
      }

      leaderY = Math.max(leaderY, racer.y);
    }

    return leaderY;
  }

  drawBackdrop(cameraY) {
    const { ctx, canvas } = this;
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#03101d");
    grad.addColorStop(0.52, "#08182b");
    grad.addColorStop(1, "#040b14");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const drift = cameraY * 0.12;
    const glowA = ctx.createRadialGradient(180, 140 - drift, 20, 180, 140 - drift, 260);
    glowA.addColorStop(0, "rgba(82,242,255,0.18)");
    glowA.addColorStop(1, "rgba(82,242,255,0)");
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const glowB = ctx.createRadialGradient(860, 220 - drift * 0.7, 20, 860, 220 - drift * 0.7, 300);
    glowB.addColorStop(0, "rgba(255,79,216,0.15)");
    glowB.addColorStop(1, "rgba(255,79,216,0)");
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawDepthLights(cameraY) {
    const { ctx, canvas } = this;
    ctx.save();
    for (let index = 0; index < 9; index += 1) {
      const y = ((index * 180 - cameraY * 0.55) % (canvas.height + 200)) - 80;
      const alpha = 0.05 + (index % 3) * 0.015;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
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
    ctx.strokeRect(52, 36, canvas.width - 104, canvas.height - 72);

    ctx.strokeStyle = "rgba(82,242,255,0.07)";
    ctx.lineWidth = 1;
    for (let x = 110; x < canvas.width - 90; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 26);
      ctx.lineTo(x, canvas.height - 26);
      ctx.stroke();
    }

    for (let offset = -1; offset <= 10; offset += 1) {
      const worldY = Math.floor(cameraY / 120) * 120 + offset * 120;
      const screenY = worldY - cameraY;
      if (screenY < -80 || screenY > canvas.height + 80) {
        continue;
      }
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(72, screenY);
      ctx.lineTo(canvas.width - 72, screenY);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawObstacles(obstacles, cameraY) {
    const { ctx, canvas } = this;
    ctx.save();

    for (const obstacle of obstacles) {
      const y = obstacle.y - cameraY;
      if (y < -120 || y > canvas.height + 120) {
        continue;
      }

      if (obstacle.kind === "bumper") {
        const grad = ctx.createRadialGradient(obstacle.x, y, 4, obstacle.x, y, obstacle.r * 1.9);
        grad.addColorStop(0, "rgba(255,255,255,0.95)");
        grad.addColorStop(0.45, "rgba(255,213,111,0.9)");
        grad.addColorStop(1, "rgba(255,213,111,0.12)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(obstacle.x, y, obstacle.r, 0, TAU);
        ctx.fill();
      } else if (obstacle.kind === "spinner") {
        ctx.strokeStyle = "rgba(255,79,216,0.75)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(obstacle.x - obstacle.r, y - obstacle.r * 0.6);
        ctx.lineTo(obstacle.x + obstacle.r, y + obstacle.r * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(obstacle.x - obstacle.r, y + obstacle.r * 0.6);
        ctx.lineTo(obstacle.x + obstacle.r, y - obstacle.r * 0.6);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,79,216,0.22)";
        ctx.beginPath();
        ctx.arc(obstacle.x, y, obstacle.r * 0.54, 0, TAU);
        ctx.fill();
      } else {
        const grad = ctx.createRadialGradient(obstacle.x, y, 2, obstacle.x, y, obstacle.r * 1.7);
        grad.addColorStop(0, "rgba(255,255,255,0.92)");
        grad.addColorStop(1, "rgba(82,242,255,0.16)");
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
    const grad = ctx.createLinearGradient(0, finishY - 60, 0, finishY + 40);
    grad.addColorStop(0, "rgba(255,213,111,0)");
    grad.addColorStop(1, "rgba(255,213,111,0.2)");
    ctx.fillStyle = grad;
    ctx.fillRect(64, finishY - 60, canvas.width - 128, 110);

    for (let x = 66; x < canvas.width - 66; x += 34) {
      ctx.fillStyle = (Math.floor((x - 66) / 34) % 2 === 0) ? "#ffffff" : "#0b1524";
      ctx.fillRect(x, finishY, 17, 24);
    }

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "700 22px Orbitron, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("FINISH", canvas.width / 2, finishY - 14);
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
      const alpha = ((index + 1) / racer.trail.length) * 0.32;
      const screenY = point.y - cameraY;
      ctx.fillStyle = hexToRgba(racer.color, alpha);
      ctx.beginPath();
      ctx.arc(point.x, screenY, 5 + index * 0.32, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawRacer(racer, cameraY) {
    const { ctx } = this;
    const screenY = racer.y - cameraY;
    if (screenY < -120 || screenY > this.canvas.height + 120) {
      return;
    }

    ctx.save();
    ctx.translate(racer.x, screenY);
    ctx.rotate(racer.rotation);

    ctx.shadowColor = racer.color;
    ctx.shadowBlur = 34;
    const grad = ctx.createRadialGradient(-4, -6, 2, 0, 0, racer.size + 6);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.32, racer.color);
    grad.addColorStop(1, darkenHex(racer.color, 0.25));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, racer.size || 19, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, (racer.size || 19) - 1, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = "#04111e";
    ctx.font = "700 11px Manrope";
    ctx.textAlign = "center";
    ctx.fillText(initials(racer.displayName), 0, 4);

    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 14px Manrope";
    ctx.fillStyle = "#eef7ff";
    ctx.fillText(cropName(racer.usernameLabel || racer.displayName, 16), racer.x, screenY - 30);
    ctx.font = "600 11px Manrope";
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(`+${racer.referralBonus || 0} chance`, racer.x, screenY - 12);
    ctx.restore();
  }

  drawHud(elapsed) {
    const { ctx, canvas } = this;
    const leader = [...this.scene.racers].sort((a, b) => b.y - a.y)[0];

    ctx.save();
    const panelGradient = ctx.createLinearGradient(40, 28, 400, 130);
    panelGradient.addColorStop(0, "rgba(5,18,31,0.92)");
    panelGradient.addColorStop(1, "rgba(10,29,48,0.8)");
    ctx.fillStyle = panelGradient;
    roundRect(ctx, 32, 24, 364, 110, 22);
    ctx.fill();

    ctx.strokeStyle = "rgba(82,242,255,0.18)";
    ctx.stroke();

    ctx.fillStyle = "#52f2ff";
    ctx.font = "700 14px Orbitron, sans-serif";
    ctx.fillText("LIVE DROP", 62, 50);

    ctx.fillStyle = "#eef7ff";
    ctx.font = "700 22px Orbitron, sans-serif";
    ctx.fillText(this.scene.title || "Raffle", 62, 84);

    if (leader) {
      ctx.font = "600 13px Manrope";
      ctx.fillStyle = "rgba(255,255,255,0.84)";
      ctx.fillText(`Лидер: ${cropName(leader.usernameLabel || leader.displayName, 22)}`, 62, 110);
    }

    const progress = leader ? Math.min(100, Math.round((leader.y / this.scene.world.finishY) * 100)) : 0;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, canvas.width - 288, 34, 236, 18, 10);
    ctx.fill();
    const fill = ctx.createLinearGradient(canvas.width - 288, 34, canvas.width - 52, 34);
    fill.addColorStop(0, "#52f2ff");
    fill.addColorStop(1, "#ffd56f");
    ctx.fillStyle = fill;
    roundRect(ctx, canvas.width - 288, 34, Math.max(18, progress * 2.36), 18, 10);
    ctx.fill();

    ctx.fillStyle = "#eef7ff";
    ctx.font = "700 14px Manrope";
    ctx.fillText(`${progress}% до финиша`, canvas.width - 288, 72);
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
  const steps = 10;
  const width = world.width - 180;

  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const swing = Math.sin(ratio * 8 + racer.seed * 0.0007) * (110 - ratio * 50);
    const noise = Math.cos(ratio * 15 + racer.seed * 0.0004) * 32;
    const base = 90 + ((racer.seed + index * 131) % 1000) / 1000 * width;
    points.push({
      progress: ratio,
      x: clamp(base + swing + noise, 86, world.width - 86),
    });
  }

  if (racer.isWinner) {
    points[points.length - 1].x = 540 + (racer.finishPlace - 1) * 54 - 54;
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
  for (let index = 0; index < obstacles.length; index += 1) {
    const obstacle = obstacles[index];
    const dx = racer.x - obstacle.x;
    const dy = racer.y - obstacle.y;
    const distance = Math.hypot(dx, dy);
    const radius = obstacle.r + (racer.size || 18) + 12;

    if (distance < radius) {
      const force = (radius - distance) / radius;
      const direction = dx === 0 ? 1 : dx / Math.abs(dx);
      const kicker =
        obstacle.kind === "spinner" ? 16 :
        obstacle.kind === "bumper" ? 24 :
        10;

      racer.x += direction * kicker * force + (obstacle.drift || 0) * 0.06;
      racer.vx += direction * kicker * 0.12;
      racer.vy *= obstacle.kind === "bumper" ? 0.93 : 0.97;
      racer.lastObstacleHit = index;
    }
  }
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
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
