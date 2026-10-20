(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const blueScoreEl = document.getElementById('blueScore');
  const redScoreEl = document.getElementById('redScore');
  const goalFlash = document.getElementById('goalFlash');
  const matchClock = document.getElementById('matchClock');
  const matchToggle = document.getElementById('matchToggle');
  const halfDurationSelect = document.getElementById('halfDuration');
  const tableWrap = document.querySelector('.table-wrap');
  const eventBanner = document.getElementById('eventBanner');
  const matchOverlay = document.getElementById('matchOverlay');
  const W = 1000;
  const H = 600;
  const field = { left: 36, right: 964, top: 35, bottom: 565 };
  const goalTop = 222;
  const goalBottom = 378;
  const rodXs = [112, 265, 418, 582, 735, 888];
  const playerCounts = [1, 2, 3, 3, 2, 1];
  const blueRods = rodXs.slice(0, 3).map((x, i) => ({ x, count: playerCounts[i], offset: H / 2, target: H / 2, kickCooldown: 0 }));
  const redRods = rodXs.slice(3).map((x, i) => ({ x, count: playerCounts[i + 3], offset: H / 2, target: H / 2, kickCooldown: 0 }));
  // Begin moving as soon as the page opens so the new-game button truly starts play.
  let ball = { x: W / 2, y: H / 2, vx: 190, vy: 65, spin: 0, r: 12 };
  let secondBall = null;
  let audioContext = null;
  let masterGain = null;
  let masterVolume = 0.45;
  let blueScore = 0;
  let redScore = 0;
  let activePointer = null;
  let activeRod = null;
  let activeStartY = 0;
  let activeStartOffset = 0;
  let lastTime = 0;
  let goalTimer = null;
  let slowMotionRemaining = 0;
  let celebrationRemaining = 0;
  let celebrationSide = 'blue';
  let animationTime = 0;
  let halfDuration = Number(halfDurationSelect.value);
  let timeRemaining = halfDuration;
  let currentHalf = 1;
  let matchRunning = true;
  let matchOver = false;
  let halftimeRemaining = 0;
  let specialRemaining = 0;
  let specialTriggered = [false, false, false];
  let eventBannerRemaining = 0;
  let lastClockText = '';
  let redMisreadRemaining = 0;
  let redMisreadCooldown = 5;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.width * (H / W) * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    draw();
  }

  function enableAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContext) {
      audioContext = new AudioContextClass();
      masterGain = audioContext.createGain();
      masterGain.gain.value = masterVolume;
      masterGain.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  }

  function playKickSound(power = 0.7) {
    if (!audioContext || !masterGain || masterVolume <= 0) return;
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(105 + power * 32, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.11);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.17 * Math.min(power, 1.2), now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
    osc.connect(envelope); envelope.connect(masterGain);
    osc.start(now); osc.stop(now + 0.2);

    const length = Math.floor(audioContext.sampleRate * 0.075);
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const noise = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();
    noise.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 1300;
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.09 * Math.min(power, 1.2), now + 0.006);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(masterGain);
    noise.start(now); noise.stop(now + 0.08);
  }

  function playGoalSound() {
    if (!audioContext || !masterGain || masterVolume <= 0) return;
    playKickSound(1.1);
    const now = audioContext.currentTime;
    [392, 523.25, 659.25].forEach((frequency, index) => {
      const osc = audioContext.createOscillator();
      const envelope = audioContext.createGain();
      const start = now + index * 0.12;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, start);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.985, start + 0.42);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(0.11, start + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.48);
      osc.connect(envelope); envelope.connect(masterGain);
      osc.start(start); osc.stop(start + 0.5);
    });
  }

  function playerYs(rod) {
    const gap = 112;
    const start = H / 2 - (rod.count - 1) * gap / 2 + rod.offset - H / 2;
    return Array.from({ length: rod.count }, (_, i) => start + i * gap);
  }

  function clampRod(rod, y) {
    const ext = (rod.count - 1) * 112 / 2;
    rod.offset = Math.max(field.top + 30 + ext, Math.min(field.bottom - 30 - ext, y));
  }

  function timeText(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function showEvent(message, duration) {
    eventBanner.textContent = message;
    eventBannerRemaining = duration;
    eventBanner.classList.add('show');
  }

  function startDoubleBall() {
    specialRemaining = 12;
    secondBall = { x: W / 2, y: H / 2 + 92, vx: ball.vx >= 0 ? -285 : 285, vy: -80, spin: 0, r: 12 };
    showEvent('⚡ DOUBLE BALL', specialRemaining);
  }

  function updateMatchUI() {
    let clockText;
    if (matchOver) clockText = 'จบเกม';
    else if (halftimeRemaining > 0) clockText = `พักครึ่ง · ${timeText(halftimeRemaining)}`;
    else clockText = `${currentHalf === 1 ? 'ครึ่งแรก' : 'ครึ่งหลัง'} · ${timeText(timeRemaining)}`;
    if (clockText !== lastClockText) { matchClock.textContent = clockText; lastClockText = clockText; }

    const overlayText = matchOver
      ? `หมดเวลา · ${blueScore > redScore ? 'สีน้ำเงินชนะ' : redScore > blueScore ? 'สีแดงชนะ' : 'เสมอกัน'}\n${blueScore} : ${redScore}`
      : halftimeRemaining > 0 ? `พักครึ่ง\nครึ่งหลังใน ${timeText(halftimeRemaining)}` : '';
    matchOverlay.textContent = overlayText;
    matchOverlay.classList.toggle('show', Boolean(overlayText));
    matchToggle.textContent = matchOver ? 'จบเกม' : matchRunning ? 'พักเกม' : 'เล่นต่อ';
    matchToggle.disabled = matchOver || halftimeRemaining > 0;

    if (specialRemaining > 0) {
      eventBanner.textContent = `⚡ DOUBLE BALL · ${timeText(specialRemaining)}`;
      eventBanner.classList.add('show');
    } else if (eventBannerRemaining > 0) {
      eventBanner.classList.add('show');
    } else {
      eventBanner.classList.remove('show');
    }
    tableWrap.classList.toggle('special-mode', specialRemaining > 0);
    tableWrap.classList.toggle('urgent-mode', matchRunning && !matchOver && timeRemaining <= 12 && timeRemaining > 0);
  }

  function updateMatchClock(dt) {
    if (halftimeRemaining > 0) {
      halftimeRemaining = Math.max(0, halftimeRemaining - dt);
      if (halftimeRemaining === 0) {
        currentHalf = 2; timeRemaining = halfDuration; matchRunning = true;
        showEvent('ครึ่งหลังเริ่มแล้ว', 2.4);
      }
    } else if (matchRunning && !matchOver) {
      timeRemaining = Math.max(0, timeRemaining - dt);
      if (!specialTriggered[currentHalf] && timeRemaining <= halfDuration / 2) {
        specialTriggered[currentHalf] = true;
        startDoubleBall();
      }
      if (specialRemaining > 0) {
        specialRemaining = Math.max(0, specialRemaining - dt);
        if (specialRemaining === 0) secondBall = null;
      }
      if (timeRemaining === 0) {
        secondBall = null; specialRemaining = 0; eventBannerRemaining = 0;
        if (currentHalf === 1) {
          matchRunning = false; halftimeRemaining = 4;
          matchOverlay.textContent = 'พักครึ่ง'; matchOverlay.classList.add('show');
        } else {
          matchRunning = false; matchOver = true;
        }
      }
    }
    if (eventBannerRemaining > 0) eventBannerRemaining = Math.max(0, eventBannerRemaining - dt);
    updateMatchUI();
  }

  function resetMatch() {
    halfDuration = Number(halfDurationSelect.value);
    timeRemaining = halfDuration; currentHalf = 1; matchRunning = true; matchOver = false;
    halftimeRemaining = 0; specialRemaining = 0; secondBall = null;
    specialTriggered = [false, false, false]; eventBannerRemaining = 0;
    redMisreadRemaining = 0; redMisreadCooldown = 5;
    blueScore = 0; redScore = 0; blueScoreEl.textContent = '0'; redScoreEl.textContent = '0';
    ball = { x: W / 2, y: H / 2, vx: 190, vy: 65, spin: 0, r: 12 };
    blueRods.concat(redRods).forEach(r => { r.offset = H / 2; r.target = H / 2; r.kickCooldown = 0; });
    slowMotionRemaining = 0; celebrationRemaining = 0;
    clearTimeout(goalTimer); goalFlash.classList.remove('show'); eventBanner.classList.remove('show');
    updateMatchUI();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // Table and playing surface
    const surface = ctx.createLinearGradient(0, 30, 0, 570);
    surface.addColorStop(0, '#28654f'); surface.addColorStop(.5, '#205a46'); surface.addColorStop(1, '#194b3d');
    ctx.fillStyle = '#4b3c2e'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = surface; ctx.fillRect(field.left, field.top, field.right - field.left, field.bottom - field.top);
    // Field markings
    ctx.strokeStyle = '#e1ede044'; ctx.lineWidth = 2;
    ctx.strokeRect(54, 53, 892, 494);
    ctx.beginPath(); ctx.moveTo(W / 2, 54); ctx.lineTo(W / 2, 546); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 76, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e1ede077'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2); ctx.fill();
    // Goal openings
    ctx.fillStyle = '#091b14'; ctx.fillRect(28, goalTop, 35, goalBottom - goalTop); ctx.fillRect(937, goalTop, 35, goalBottom - goalTop);
    ctx.strokeStyle = '#c5a474'; ctx.lineWidth = 4; ctx.strokeRect(29, goalTop, 34, goalBottom - goalTop); ctx.strokeRect(937, goalTop, 34, goalBottom - goalTop);
    // Rods and players
    blueRods.forEach((rod, i) => drawRod(rod, '#51aaff', '#d8efff', i === 0 ? 'blue' : 'blue'));
    redRods.forEach((rod, i) => drawRod(rod, '#f2675d', '#ffe2dd', i === 0 ? 'red' : 'red'));
    drawBall(ball);
    if (secondBall) drawBall(secondBall);
    if (celebrationRemaining > 0) drawCelebration();
  }

  function drawBall(orb) {
    ctx.fillStyle = '#06100e77'; ctx.beginPath(); ctx.ellipse(orb.x + 4, orb.y + 6, orb.r * 1.05, orb.r * .75, 0, 0, Math.PI * 2); ctx.fill();
    const ballGrad = ctx.createRadialGradient(orb.x - 4, orb.y - 5, 1, orb.x, orb.y, orb.r + 3);
    ballGrad.addColorStop(0, '#fff'); ballGrad.addColorStop(1, '#d6ded8');
    ctx.fillStyle = ballGrad; ctx.beginPath(); ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#46514d'; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.save(); ctx.translate(orb.x, orb.y); ctx.rotate(orb.spin);
    ctx.fillStyle = '#26312c'; ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
      const x = Math.cos(a) * 4.2, y = Math.sin(a) * 4.2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#55615a'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 4.2, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, 4.2, 9, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawRod(rod, color, light) {
    ctx.fillStyle = '#d5bb8c'; ctx.fillRect(rod.x - 5, field.top + 4, 10, field.bottom - field.top - 8);
    ctx.fillStyle = '#69482d'; ctx.fillRect(rod.x - 2, field.top + 4, 4, field.bottom - field.top - 8);
    for (const y of playerYs(rod)) {
      const py = Math.max(field.top + 29, Math.min(field.bottom - 29, y));
      // Feet and body make each player easy to distinguish at phone size.
      ctx.fillStyle = '#081b14aa'; ctx.beginPath(); ctx.ellipse(rod.x + 3, py + 22, 17, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(rod.x - 14, py - 19, 28, 39, 9); ctx.fill();
      ctx.strokeStyle = light; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = light; ctx.beginPath(); ctx.arc(rod.x, py - 7, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#173027'; ctx.fillRect(rod.x - 12, py + 15, 24, 7);
    }
  }

  function collideRod(rod, direction) {
    for (const y of playerYs(rod)) {
      const py = Math.max(field.top + 29, Math.min(field.bottom - 29, y));
      const dx = ball.x - rod.x;
      const dy = ball.y - py;
      const distance = Math.hypot(dx, dy);
      const reach = ball.r + 17;
      if (distance < reach) {
        const nx = distance ? dx / distance : direction;
        const ny = distance ? dy / distance : 0;
        ball.x = rod.x + nx * reach;
        ball.y = py + ny * reach;
        if (rod.kickCooldown <= 0) {
          const impact = Math.hypot(ball.vx, ball.vy);
          ball.vx = direction * Math.max(255, impact * .72 + 145);
          ball.vy += ny * 105 + (py - rod.offset) * .15;
          ball.spin += direction * .7;
          rod.kickCooldown = .34;
          playKickSound(.62);
        } else {
          ball.vx = direction * Math.max(130, Math.abs(ball.vx) * .6);
        }
      }
    }
  }

  function autoKickRod(rod, direction) {
    if (rod.kickCooldown > 0) return;
    let nearest = null;
    for (const y of playerYs(rod)) {
      const py = Math.max(field.top + 29, Math.min(field.bottom - 29, y));
      const distance = Math.hypot(ball.x - rod.x, ball.y - py);
      if (!nearest || distance < nearest.distance) nearest = { y: py, distance };
    }
    // Kick as soon as the ball is close to a player, without requiring a button press.
    if (!nearest || nearest.distance > ball.r + 20) return;
    const offsetY = ball.y - nearest.y;
    ball.x = rod.x + direction * (ball.r + 18);
    ball.vx = direction * Math.max(260, Math.abs(ball.vx) * .72 + 145);
    ball.vy += Math.max(-190, Math.min(190, offsetY * 1.5));
    ball.spin += direction * .55;
    rod.kickCooldown = .34;
    playKickSound(.62);
  }

  function kick(power = 0.6) {
    enableAudio();
    let nearest = null;
    [ball, ...(secondBall ? [secondBall] : [])].forEach(orb => blueRods.forEach(rod => {
      for (const y of playerYs(rod)) {
        const d = Math.hypot(orb.x - rod.x, orb.y - y);
        if (!nearest || d < nearest.d) nearest = { d, rod, y, orb };
      }
    }));
    if (nearest && nearest.d < 160) {
      const activeBall = ball;
      ball = nearest.orb;
      const dy = ball.y - nearest.y;
      const contact = Math.max(.2, 1 - nearest.d / 190);
      ball.vx = Math.max(0, ball.vx * .42) + 130 + power * 360 * contact;
      ball.vy += Math.max(-250, Math.min(250, dy * (1.1 + power * 1.2)));
      ball.spin += .5 + power * .8;
      nearest.rod.kickCooldown = .3;
      playKickSound(power);
      ball = activeBall;
    }
  }

  function score(side) {
    if (side === 'blue') blueScore++; else redScore++;
    blueScoreEl.textContent = blueScore;
    redScoreEl.textContent = redScore;
    goalFlash.textContent = side === 'blue' ? '⚽ GOAL! +1' : 'ทีมสีแดงยิงเข้า!';
    goalFlash.classList.add('show');
    clearTimeout(goalTimer);
    goalTimer = setTimeout(() => goalFlash.classList.remove('show'), 3000);
    playGoalSound();
    slowMotionRemaining = 1.15;
    celebrationRemaining = 3.6;
    celebrationSide = side;
    ball.x = W / 2; ball.y = H / 2; ball.vx = side === 'blue' ? -175 : 175; ball.vy = (Math.random() - .5) * 150; ball.spin = 0;
    blueRods.concat(redRods).forEach(r => { r.target = H / 2; r.kickCooldown = 0; });
  }

  function update(dt) {
    const steps = Math.max(1, Math.ceil(dt * 120));
    const step = dt / steps;
    for (let i = 0; i < steps; i++) updateStep(step);
  }

  function updateStep(dt) {
    redMisreadRemaining = Math.max(0, redMisreadRemaining - dt);
    redMisreadCooldown = Math.max(0, redMisreadCooldown - dt);
    const ballsInPlay = [ball, ...(secondBall ? [secondBall] : [])];
    const incomingShot = ballsInPlay.find(orb => orb.x > 640 && orb.vx > 100);
    if (incomingShot && redMisreadRemaining <= 0 && redMisreadCooldown <= 0 && Math.random() < dt * .12) {
      // A rare keeper misread leaves a real opening for the human player to score.
      redMisreadRemaining = .85;
      redMisreadCooldown = 12;
    }
    // The computer tracks the nearest ball and anticipates its path, but leaves occasional openings.
    redRods.forEach((rod, i) => {
      const bias = i === 0 ? -15 : i === 2 ? 15 : 0;
      const targetBall = secondBall && Math.abs(secondBall.x - rod.x) < Math.abs(ball.x - rod.x) ? secondBall : ball;
      let targetY = targetBall.y + targetBall.vy * .13 + bias;
      if (i >= 1 && redMisreadRemaining > 0) targetY += targetBall.y < H / 2 ? 130 : -130;
      const desired = Math.max(field.top + 60, Math.min(field.bottom - 60, targetY));
      rod.offset += (desired - rod.offset) * Math.min(1, dt * (i === 1 ? 6.2 : 4.4));
    });
    blueRods.concat(redRods).forEach(rod => { rod.kickCooldown = Math.max(0, rod.kickCooldown - dt); });
    updateOrb(ball, dt);
    if (secondBall) updateOrb(secondBall, dt);
  }

  function updateOrb(orb, dt) {
    const activeBall = ball;
    ball = orb;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 0) {
      const nextSpeed = Math.max(0, speed - 28 * dt);
      const rolling = nextSpeed / speed;
      ball.vx *= rolling; ball.vy *= rolling;
      ball.spin += speed * dt / ball.r;
    }
    if (ball.y - ball.r < field.top + 8) { ball.y = field.top + 8 + ball.r; ball.vy = Math.abs(ball.vy) * .76; ball.spin *= .94; }
    if (ball.y + ball.r > field.bottom - 8) { ball.y = field.bottom - 8 - ball.r; ball.vy = -Math.abs(ball.vy) * .76; ball.spin *= .94; }
    blueRods.forEach(r => autoKickRod(r, 1));
    redRods.forEach(r => autoKickRod(r, -1));
    blueRods.forEach(r => collideRod(r, 1));
    redRods.forEach(r => collideRod(r, -1));
    if (ball.x < field.left - 10) {
      if (ball.y > goalTop && ball.y < goalBottom) score('red');
      else { ball.x = field.left + ball.r; ball.vx = Math.abs(ball.vx) * .8; }
    }
    if (ball.x > field.right + 10) {
      if (ball.y > goalTop && ball.y < goalBottom) score('blue');
      else { ball.x = field.right - ball.r; ball.vx = -Math.abs(ball.vx) * .8; }
    }
    const finalSpeed = Math.hypot(ball.vx, ball.vy);
    if (finalSpeed > 780) { ball.vx *= 780 / finalSpeed; ball.vy *= 780 / finalSpeed; }
    ball = activeBall;
  }

  function loop(time) {
    const dt = Math.min((time - (lastTime || time)) / 1000, .035);
    lastTime = time;
    updateMatchClock(dt);
    if (matchRunning && !matchOver) {
      animationTime += dt;
      const gameSpeed = slowMotionRemaining > 0 ? .22 : 1;
      if (slowMotionRemaining > 0) slowMotionRemaining = Math.max(0, slowMotionRemaining - dt);
      if (celebrationRemaining > 0) celebrationRemaining = Math.max(0, celebrationRemaining - dt);
      update(dt * gameSpeed);
    }
    draw();
    requestAnimationFrame(loop);
  }

  function drawCelebration() {
    const elapsed = 3.6 - celebrationRemaining;
    const kickPhase = elapsed >= 1.05 && elapsed < 1.85;
    const cheering = elapsed >= 1.85;
    const teamColor = celebrationSide === 'blue' ? '#3296f4' : '#ed554f';
    const lightColor = celebrationSide === 'blue' ? '#9ed4ff' : '#ffb2a8';
    const jump = cheering ? Math.abs(Math.sin((elapsed - 1.85) * 4)) * 13 : 0;
    const run = !kickPhase && !cheering ? Math.sin(elapsed * 13) : 0;
    const kick = kickPhase ? Math.min(1, (elapsed - 1.05) / .28) : 0;
    const cx = 500 + (celebrationSide === 'blue' ? -1 : 1) * Math.min(elapsed, 1) * 24;
    const headY = 250 - jump;

    // Dim the table and add a soft spotlight behind the celebratory player.
    ctx.save();
    ctx.fillStyle = '#06150fcc'; ctx.fillRect(0, 0, W, H);
    const spotlight = ctx.createRadialGradient(cx, 365 - jump, 25, cx, 365 - jump, 255);
    spotlight.addColorStop(0, '#ffffff21'); spotlight.addColorStop(1, '#ffffff00');
    ctx.fillStyle = spotlight; ctx.fillRect(180, 90, 640, 500);

    // Confetti
    const confettiColors = ['#c2a567', '#8da9a1', '#a46b64', '#83999a', '#d3c9b2'];
    for (let i = 0; i < 18; i++) {
      const seed = i * 73.7;
      const x = (seed + Math.sin(animationTime * 2 + i) * 35 + 160) % 680 + 160;
      const y = (seed * 1.81 + animationTime * (105 + i % 4 * 18)) % 530 + 30;
      ctx.save(); ctx.translate(x, y); ctx.rotate(animationTime * 2 + i);
      ctx.fillStyle = confettiColors[i % confettiColors.length];
      ctx.fillRect(-3, -7, 6, 14); ctx.restore();
    }

    // Ground shadow
    ctx.fillStyle = '#0008'; ctx.beginPath(); ctx.ellipse(cx, 515, 64 - jump * .35, 13, 0, 0, Math.PI * 2); ctx.fill();

    // Legs, with the right leg swinging forward for the kick.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const legGrad = ctx.createLinearGradient(cx - 28, 370, cx + 30, 500);
    legGrad.addColorStop(0, '#f4c7a1'); legGrad.addColorStop(1, '#b87558');
    ctx.strokeStyle = legGrad; ctx.lineWidth = 23;
    ctx.beginPath(); ctx.moveTo(cx - 17, 365 - jump); ctx.lineTo(cx - 26 - run * 10, 414 - jump); ctx.lineTo(cx - 32 + run * 13, 480 - jump); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 17, 365 - jump);
    if (kickPhase) {
      const footX = cx + 86 * kick;
      const footY = 420 - 63 * Math.sin(kick * Math.PI / 2);
      ctx.lineTo(cx + 28, 405 - jump); ctx.lineTo(footX, footY - jump);
      ctx.stroke();
      // A small motion streak emphasizes the kick.
      ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 6; ctx.beginPath();
      ctx.moveTo(footX - 34, footY - 12 - jump); ctx.lineTo(footX - 8, footY - 12 - jump); ctx.stroke();
    } else {
      ctx.lineTo(cx + 24 + run * 10, 416 - jump); ctx.lineTo(cx + 31 - run * 12, 480 - jump); ctx.stroke();
    }
    // Socks and shoes
    ctx.strokeStyle = '#f4f5f2'; ctx.lineWidth = 17;
    ctx.beginPath(); ctx.moveTo(cx - 32 + run * 13, 464 - jump); ctx.lineTo(cx - 32 + run * 13, 485 - jump); ctx.stroke();
    ctx.strokeStyle = '#18262b'; ctx.lineWidth = 15;
    ctx.beginPath(); ctx.moveTo(cx - 32 + run * 13, 490 - jump); ctx.lineTo(cx - 15 + run * 13, 494 - jump); ctx.stroke();
    if (!kickPhase) {
      ctx.strokeStyle = '#f4f5f2'; ctx.lineWidth = 17; ctx.beginPath();
      ctx.moveTo(cx + 31 - run * 12, 464 - jump); ctx.lineTo(cx + 31 - run * 12, 485 - jump); ctx.stroke();
      ctx.strokeStyle = '#18262b'; ctx.lineWidth = 15; ctx.beginPath();
      ctx.moveTo(cx + 31 - run * 12, 490 - jump); ctx.lineTo(cx + 49 - run * 12, 494 - jump); ctx.stroke();
    }

    // Torso and shorts, shaded to give the illustration a rounded 3D look.
    const jersey = ctx.createLinearGradient(cx - 45, 275 - jump, cx + 42, 370 - jump);
    jersey.addColorStop(0, lightColor); jersey.addColorStop(.35, teamColor); jersey.addColorStop(1, celebrationSide === 'blue' ? '#1452a4' : '#992d36');
    ctx.fillStyle = jersey; ctx.beginPath(); ctx.roundRect(cx - 39, 275 - jump, 78, 102, 24); ctx.fill();
    ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(cx - 23, 292 - jump); ctx.quadraticCurveTo(cx - 33, 326 - jump, cx - 20, 351 - jump); ctx.stroke();
    ctx.fillStyle = celebrationSide === 'blue' ? '#163a72' : '#782a31';
    ctx.beginPath(); ctx.roundRect(cx - 35, 354 - jump, 70, 31, 9); ctx.fill();
    ctx.fillStyle = '#f4f5f2'; ctx.fillRect(cx - 35, 378 - jump, 70, 6);

    // Arms: running swing, kicking balance, then both arms raised in celebration.
    const armGrad = ctx.createLinearGradient(cx - 60, 290, cx + 60, 370);
    armGrad.addColorStop(0, '#f7d1ae'); armGrad.addColorStop(1, '#b87558');
    ctx.strokeStyle = armGrad; ctx.lineWidth = 19;
    ctx.beginPath(); ctx.moveTo(cx - 35, 294 - jump);
    if (cheering) ctx.lineTo(cx - 62, 233 - jump);
    else ctx.lineTo(cx - 61, 330 - jump - run * 18);
    ctx.lineTo(cx - 72, cheering ? 188 - jump : 349 - jump - run * 27); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 35, 294 - jump);
    if (cheering) ctx.lineTo(cx + 62, 233 - jump);
    else ctx.lineTo(cx + 61, 330 - jump + run * 18);
    ctx.lineTo(cx + 72, cheering ? 188 - jump : 349 - jump + run * 27); ctx.stroke();
    if (cheering) {
      ctx.fillStyle = '#f1c29e';
      ctx.beginPath(); ctx.arc(cx - 72, 185 - jump, 12, 0, Math.PI * 2); ctx.arc(cx + 72, 185 - jump, 12, 0, Math.PI * 2); ctx.fill();
    }

    // Head, hair and face
    const skin = ctx.createRadialGradient(cx - 9, headY - 13, 2, cx, headY, 33);
    skin.addColorStop(0, '#ffe0bd'); skin.addColorStop(1, '#bc795b');
    ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(cx, headY, 28, 34, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#30231e'; ctx.beginPath(); ctx.ellipse(cx, headY - 24, 28, 13, -.1, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#38251e'; ctx.beginPath(); ctx.arc(cx - 9, headY + 1, 2.5, 0, Math.PI * 2); ctx.arc(cx + 9, headY + 1, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7e3c34'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, headY + 8, 9, .15, Math.PI - .15); ctx.stroke();

    // Kick a small illustrated ball forward, then let confetti finish the celebration.
    if (kickPhase) {
      const progress = (elapsed - 1.05) / .8;
      const bx = cx + 92 + progress * 125;
      const by = 418 - Math.sin(progress * Math.PI) * 82;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, 17, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#35443b'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#26352d'; ctx.beginPath(); ctx.arc(bx + 4, by - 3, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
  }
  canvas.addEventListener('pointerdown', event => {
    const p = pointerPosition(event);
    const tappedBall = [ball, ...(secondBall ? [secondBall] : [])].some(orb => Math.hypot(p.x - orb.x, p.y - orb.y) <= orb.r + 20);
    if (tappedBall) {
      event.preventDefault();
      kick();
      return;
    }
    // Let the player grab anywhere on their half of the table; this is easier
    // to hit with a mouse than the narrow visual rod, especially in Chrome.
    if (p.x > W / 2 + 18) return;
    const rod = blueRods.reduce((best, candidate) => Math.abs(candidate.x - p.x) < Math.abs(best.x - p.x) ? candidate : best, blueRods[0]);
    event.preventDefault();
    activePointer = event.pointerId; activeRod = rod;
    activeStartY = p.y;
    activeStartOffset = rod.offset;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer || !activeRod) return;
    event.preventDefault();
    const p = pointerPosition(event);
    // Keep the rod aligned with the exact point the player grabbed, instead of
    // snapping the rod's center to the pointer when grabbing an end player.
    clampRod(activeRod, activeStartOffset + p.y - activeStartY);
  });
  function endPointer(event) {
    if (event.pointerId === activePointer) { activePointer = null; activeRod = null; }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  document.getElementById('softKickButton').addEventListener('click', () => kick(0.42));
  document.getElementById('kickButton').addEventListener('click', () => kick(1));
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  volumeSlider.addEventListener('input', () => {
    enableAudio();
    masterVolume = Number(volumeSlider.value) / 100;
    volumeValue.textContent = `${volumeSlider.value}%`;
    if (masterGain) masterGain.gain.setTargetAtTime(masterVolume, audioContext.currentTime, 0.025);
  });
  document.addEventListener('pointerdown', enableAudio, { once: true });
  document.addEventListener('keydown', enableAudio, { once: true });
  document.getElementById('resetButton').addEventListener('click', resetMatch);
  matchToggle.addEventListener('click', () => {
    if (matchOver || halftimeRemaining > 0) return;
    matchRunning = !matchRunning;
    updateMatchUI();
  });
  halfDurationSelect.addEventListener('change', resetMatch);
  window.addEventListener('resize', resize);
  updateMatchUI();
  resize();
  requestAnimationFrame(loop);
})();

