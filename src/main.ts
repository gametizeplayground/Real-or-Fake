import Phaser from 'phaser';
import questions from './questions.json';
import './styles.css';

type Answer = 'REAL' | 'FAKE';

type Question = {
  id: string;
  category: string;
  type: string;
  questionText: string;
  image: string | null;
  correctAnswer: Answer;
  difficulty: number;
  explanation: string;
  tags: string[];
};

type GameConfig = {
  durationSeconds: number;
  startingLives: number;
  swipeLeftAnswer: Answer;
  swipeRightAnswer: Answer;
  leaderboardEnabled: boolean;
};

type RunStats = {
  score: number;
  combo: number;
  bestCombo: number;
  lives: number;
  correct: number;
  wrong: number;
  answered: number;
  startedAt: number;
  lastQuestionAt: number;
};

const GAME_CONFIG: GameConfig = {
  durationSeconds: 30,
  startingLives: 3,
  swipeLeftAnswer: 'FAKE',
  swipeRightAnswer: 'REAL',
  leaderboardEnabled: true
};

const typedQuestions = questions as Question[];

class QuestionManager {
  private pool: Question[] = [];
  private recentlySeen: string[] = [];
  private categoryCursor = 0;

  constructor(private readonly source: Question[]) {
    this.pool = this.shuffle([...source]);
  }

  next(combo: number, accuracy: number): Question {
    if (this.pool.length === 0) {
      this.pool = this.shuffle([...this.source].filter((question) => !this.recentlySeen.includes(question.id)));
    }

    const targetDifficulty = Math.min(3, 1 + Math.floor(combo / 7) + (accuracy > 0.78 ? 1 : 0));
    const categories = [...new Set(this.source.map((question) => question.category))];
    const desiredCategory = categories[this.categoryCursor % categories.length];
    this.categoryCursor += 1;

    const index = this.pool.findIndex((question) => question.category === desiredCategory && question.difficulty <= targetDifficulty);
    const fallbackIndex = this.pool.findIndex((question) => question.difficulty <= targetDifficulty);
    const chosenIndex = index >= 0 ? index : fallbackIndex >= 0 ? fallbackIndex : 0;
    const [question] = this.pool.splice(chosenIndex, 1);

    this.recentlySeen.push(question.id);
    this.recentlySeen = this.recentlySeen.slice(-Math.ceil(this.source.length / 2));
    return question;
  }

  private shuffle<T>(items: T[]): T[] {
    return items
      .map((item) => ({ item, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ item }) => item);
  }
}

class ScoreManager {
  pointsFor(question: Question, reactionMs: number, combo: number): number {
    const speedBonus = reactionMs < 750 ? 100 : reactionMs < 1250 ? 70 : reactionMs < 2000 ? 40 : 10;
    const difficultyBonus = question.difficulty * 50;
    const multiplier = Math.min(3, 1 + Math.floor(combo / 5) * 0.25);
    return Math.round((100 + speedBonus + difficultyBonus) * multiplier);
  }
}

class LeaderboardBridge {
  submit(stats: RunStats): void {
    const payload = {
      playerId: this.query('playerId') ?? 'guest',
      campaignId: this.query('campaignId') ?? 'demo_campaign',
      gameId: 'real_or_fake',
      score: stats.score,
      accuracy: stats.answered ? stats.correct / stats.answered : 0,
      correctAnswers: stats.correct,
      wrongAnswers: stats.wrong,
      bestCombo: stats.bestCombo,
      questionsAnswered: stats.answered,
      durationSeconds: GAME_CONFIG.durationSeconds,
      timestamp: new Date().toISOString()
    };

    window.dispatchEvent(new CustomEvent('gametize:score-submit', { detail: payload }));
    localStorage.setItem('realOrFakeLastScore', JSON.stringify(payload));
  }

  private query(key: string): string | null {
    return new URLSearchParams(window.location.search).get(key);
  }
}

class HudController {
  private readonly timerLabel = this.byId('timer-label');
  private readonly timerFill = this.byId('timer-fill');
  private readonly score = this.byId('score');
  private readonly combo = this.byId('combo');
  private readonly lives = this.byId('lives');
  private readonly menu = this.byId('menu');
  private readonly countdown = this.byId('countdown');
  private readonly countdownText = this.byId('countdown-text');
  private readonly result = this.byId('result');
  private readonly resultScore = this.byId('result-score');
  private readonly resultAccuracy = this.byId('result-accuracy');
  private readonly resultCombo = this.byId('result-combo');
  private readonly resultAnswered = this.byId('result-answered');
  private readonly resultTitle = this.byId('result-title');
  private readonly toast = this.byId('toast');

  onStart(callback: () => void): void {
    this.byId('start-button').addEventListener('click', callback);
    this.byId('replay-button').addEventListener('click', callback);
    this.byId('share-button').addEventListener('click', () => this.share());
  }

  showMenu(): void {
    this.setScreen(this.menu);
  }

  showCountdown(value: string): void {
    this.setScreen(this.countdown);
    this.countdownText.textContent = value;
    this.countdownText.classList.toggle('word', value.length > 1);
    this.countdownText.classList.remove('pop');
    void this.countdownText.offsetWidth;
    this.countdownText.classList.add('pop');
  }

  showGame(): void {
    this.setScreen(null);
  }

  update(stats: RunStats, remainingMs: number): void {
    const remainingSeconds = Math.max(0, remainingMs / 1000);
    this.timerLabel.textContent = remainingSeconds.toFixed(1);
    this.timerFill.style.transform = `scaleX(${remainingSeconds / GAME_CONFIG.durationSeconds})`;
    this.score.textContent = String(stats.score);
    this.combo.textContent = `x${stats.combo}`;
    this.lives.textContent = String(stats.lives);
    document.body.dataset.comboTier = String(Math.min(5, Math.floor(stats.combo / 5)));
    document.body.classList.toggle('danger-time', remainingSeconds <= 5);
  }

  showResult(stats: RunStats): void {
    this.setScreen(this.result);
    const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
    this.resultTitle.textContent = stats.score >= 6500 ? 'Panel Legend' : stats.score >= 3500 ? 'Sharp Instincts' : 'Run It Back';
    this.resultScore.textContent = String(stats.score);
    this.resultAccuracy.textContent = `${accuracy}%`;
    this.resultCombo.textContent = String(stats.bestCombo);
    this.resultAnswered.textContent = String(stats.answered);
  }

  flash(message: string, type: 'good' | 'bad'): void {
    this.toast.textContent = message;
    this.toast.className = type;
    window.setTimeout(() => {
      this.toast.className = '';
    }, 900);
  }

  private share(): void {
    const payload = localStorage.getItem('realOrFakeLastScore');
    const score = payload ? JSON.parse(payload).score : 0;
    const text = `I scored ${score} in Real or Fake. Can you beat my swipe instincts?`;
    if (navigator.share) {
      void navigator.share({ title: 'Real or Fake', text });
    } else {
      void navigator.clipboard?.writeText(text);
      this.flash('CHALLENGE COPIED!', 'good');
    }
  }

  private setScreen(active: HTMLElement | null): void {
    [this.menu, this.countdown, this.result].forEach((screen) => screen.classList.toggle('active', screen === active));
    document.body.classList.toggle('playing', active === null);
  }

  private byId(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element: ${id}`);
    }
    return element;
  }
}

class GameScene extends Phaser.Scene {
  private hud!: HudController;
  private questionManager = new QuestionManager(typedQuestions);
  private scoreManager = new ScoreManager();
  private leaderboard = new LeaderboardBridge();
  private stats!: RunStats;
  private currentQuestion!: Question;
  private card!: Phaser.GameObjects.Container;
  private cardBackground!: Phaser.GameObjects.Graphics;
  private cardText!: Phaser.GameObjects.Text;
  private cardType!: Phaser.GameObjects.Text;
  private answerStamp!: Phaser.GameObjects.Text;
  private particles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private isRunning = false;
  private runEndsAt = 0;
  private dragStartX = 0;
  private dragStartY = 0;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.hud = new HudController();
    this.hud.onStart(() => void this.startRun());
    this.createBackground();
    this.createCard();
    this.createParticles();
    this.hud.showMenu();
    this.scale.on('resize', () => this.layoutCard());
  }

  update(time: number): void {
    if (!this.isRunning) {
      return;
    }

    const remaining = this.runEndsAt - time;
    this.hud.update(this.stats, remaining);
    if (remaining <= 0 || this.stats.lives <= 0) {
      this.endRun();
    }
  }

  private async startRun(): Promise<void> {
    this.resetStats();
    this.hud.update(this.stats, GAME_CONFIG.durationSeconds * 1000);
    for (const value of ['3', '2', '1', 'SWIPE!']) {
      this.hud.showCountdown(value);
      await this.delay(value === 'SWIPE!' ? 380 : 620);
    }

    this.isRunning = true;
    this.runEndsAt = this.time.now + GAME_CONFIG.durationSeconds * 1000;
    this.hud.showGame();
    this.nextQuestion();
  }

  private resetStats(): void {
    this.stats = {
      score: 0,
      combo: 0,
      bestCombo: 0,
      lives: GAME_CONFIG.startingLives,
      correct: 0,
      wrong: 0,
      answered: 0,
      startedAt: this.time.now,
      lastQuestionAt: this.time.now
    };
  }

  private nextQuestion(): void {
    const accuracy = this.stats.answered ? this.stats.correct / this.stats.answered : 1;
    this.currentQuestion = this.questionManager.next(this.stats.combo, accuracy);
    this.stats.lastQuestionAt = this.time.now;
    this.cardText.setText(this.currentQuestion.questionText);
    this.cardType.setText(`${this.currentQuestion.type.toUpperCase()} // ${this.currentQuestion.category.replace('_', ' ').toUpperCase()}`);
    this.answerStamp.setAlpha(0);
    this.layoutCard();
    this.tweens.add({
      targets: this.card,
      x: this.scale.width / 2,
      y: this.scale.height / 2 + 8,
      angle: Phaser.Math.Between(-3, 3),
      scale: 1,
      alpha: 1,
      duration: 130,
      ease: 'Back.Out'
    });
  }

  private judge(answer: Answer): void {
    if (!this.isRunning) {
      return;
    }

    const correct = answer === this.currentQuestion.correctAnswer;
    const reactionMs = this.time.now - this.stats.lastQuestionAt;
    this.stats.answered += 1;

    if (correct) {
      this.stats.combo += 1;
      this.stats.bestCombo = Math.max(this.stats.bestCombo, this.stats.combo);
      this.stats.correct += 1;
      this.stats.score += this.scoreManager.pointsFor(this.currentQuestion, reactionMs, this.stats.combo);
      this.hud.flash(this.stats.combo >= 10 ? 'BAM! ON FIRE!' : answer === 'REAL' ? 'TRUTH!' : 'BUSTED!', 'good');
      this.burst(0x28f28b);
      this.cameras.main.flash(95, 40, 242, 139);
    } else {
      this.stats.combo = 0;
      this.stats.wrong += 1;
      this.stats.lives -= 1;
      this.hud.flash('OUCH!', 'bad');
      this.burst(0xff3b4e);
      this.cameras.main.shake(140, 0.012);
      window.navigator.vibrate?.(65);
    }

    this.hud.update(this.stats, this.runEndsAt - this.time.now);
    this.tweens.add({
      targets: this.card,
      x: answer === 'REAL' ? this.scale.width + 260 : -260,
      angle: answer === 'REAL' ? 24 : -24,
      alpha: 0,
      duration: 120,
      ease: 'Quad.In',
      onComplete: () => {
        if (this.isRunning) {
          this.nextQuestion();
        }
      }
    });
  }

  private endRun(): void {
    this.isRunning = false;
    this.card.setAlpha(0);
    this.leaderboard.submit(this.stats);
    this.hud.showResult(this.stats);
  }

  private createBackground(): void {
    const background = this.add.graphics();
    background.fillGradientStyle(0x11121a, 0x1d1430, 0x101923, 0x160d1d, 1);
    background.fillRect(0, 0, this.scale.width, this.scale.height);

    for (let i = 0; i < 56; i += 1) {
      const dot = this.add.circle(
        Phaser.Math.Between(0, this.scale.width),
        Phaser.Math.Between(0, this.scale.height),
        Phaser.Math.Between(1, 3),
        0xffe14d,
        Phaser.Math.FloatBetween(0.08, 0.25)
      );
      dot.setBlendMode(Phaser.BlendModes.ADD);
    }
  }

  private createCard(): void {
    this.card = this.add.container(this.scale.width / 2, this.scale.height / 2 + 8).setAlpha(0).setScale(0.92);
    this.cardBackground = this.add.graphics();
    this.cardType = this.add.text(0, 0, '', {
      fontFamily: 'Arial Black, Impact, sans-serif',
      fontSize: '13px',
      color: '#2ee7ff'
    });
    this.cardText = this.add.text(0, 0, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '30px',
      color: '#11121a',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: 300 }
    }).setOrigin(0.5);
    this.answerStamp = this.add.text(0, 0, '', {
      fontFamily: 'Arial Black, Impact, sans-serif',
      fontSize: '48px',
      color: '#ffffff',
      stroke: '#050509',
      strokeThickness: 8
    }).setOrigin(0.5).setAlpha(0);

    this.card.add([this.cardBackground, this.cardType, this.cardText, this.answerStamp]);
    this.card.setInteractive(new Phaser.Geom.Rectangle(-170, -220, 340, 440), Phaser.Geom.Rectangle.Contains);
    this.input.setDraggable(this.card);

    this.input.on('dragstart', (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.Container) => {
      if (object !== this.card || !this.isRunning) {
        return;
      }
      this.dragStartX = this.card.x;
      this.dragStartY = this.card.y;
    });

    this.input.on('drag', (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.Container, dragX: number, dragY: number) => {
      if (object !== this.card || !this.isRunning) {
        return;
      }
      const deltaX = dragX - this.dragStartX;
      this.card.x = dragX;
      this.card.y = dragY;
      this.card.angle = Phaser.Math.Clamp(deltaX / 10, -18, 18);
      const answer = deltaX >= 0 ? GAME_CONFIG.swipeRightAnswer : GAME_CONFIG.swipeLeftAnswer;
      this.answerStamp.setText(answer);
      this.answerStamp.setColor(answer === 'REAL' ? '#28f28b' : '#ff3b4e');
      this.answerStamp.setAlpha(Math.min(1, Math.abs(deltaX) / 95));
    });

    this.input.on('dragend', (_pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.Container) => {
      if (object !== this.card || !this.isRunning) {
        return;
      }
      const deltaX = this.card.x - this.dragStartX;
      if (Math.abs(deltaX) > 90) {
        this.judge(deltaX > 0 ? GAME_CONFIG.swipeRightAnswer : GAME_CONFIG.swipeLeftAnswer);
        return;
      }
      this.tweens.add({ targets: this.card, x: this.dragStartX, y: this.dragStartY, angle: 0, duration: 120, ease: 'Back.Out' });
      this.answerStamp.setAlpha(0);
    });
  }

  private layoutCard(): void {
    const width = Math.min(344, this.scale.width - 34);
    const height = Math.min(450, this.scale.height * 0.56);
    this.cardBackground.clear();
    this.cardBackground.fillStyle(0x050509, 1);
    this.cardBackground.fillRoundedRect(-width / 2 + 8, -height / 2 + 10, width, height, 18);
    this.cardBackground.fillStyle(0xfff7e8, 1);
    this.cardBackground.fillRoundedRect(-width / 2, -height / 2, width, height, 18);
    this.cardBackground.lineStyle(5, 0x050509, 1);
    this.cardBackground.strokeRoundedRect(-width / 2, -height / 2, width, height, 18);
    this.cardBackground.lineStyle(2, 0xff4fd8, 1);
    this.cardBackground.strokeRoundedRect(-width / 2 + 12, -height / 2 + 12, width - 24, height - 24, 10);

    this.cardType.setPosition(-width / 2 + 24, -height / 2 + 24);
    this.cardText.setPosition(0, 4);
    this.cardText.setWordWrapWidth(width - 56);
    this.answerStamp.setPosition(0, height / 2 - 88);
  }

  private createParticles(): void {
    const particle = this.add.graphics();
    particle.fillStyle(0xffffff, 1);
    particle.fillCircle(8, 8, 8);
    particle.generateTexture('spark', 16, 16);
    particle.destroy();
    this.particles = this.add.particles(0, 0, 'spark', {
      lifespan: 260,
      speed: { min: 160, max: 420 },
      scale: { start: 0.9, end: 0 },
      quantity: 0,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD
    });
  }

  private burst(color: number): void {
    this.particles.setParticleTint(color);
    this.particles.explode(24 + Math.min(28, this.stats.combo * 2), this.scale.width / 2, this.scale.height / 2);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: '#11121a',
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: 'game-root',
    width: window.innerWidth,
    height: window.innerHeight
  },
  scene: [GameScene],
  input: {
    activePointers: 3
  }
});

window.addEventListener('orientationchange', () => {
  window.setTimeout(() => game.scale.refresh(), 250);
});
