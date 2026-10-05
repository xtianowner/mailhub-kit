/* 通用品牌包的插画：一只「站在展示台上的信封」，不含任何个人形象。
   三个姿势与作者品牌包的手办一一对应：hero（登录页，信纸半抽出、封蜡发光）/ search（空状态、404：放大镜找信）/
   wait（加载、首次使用：一摞信在等）。颜色全部走 token（类名的样式在 styles/hub.css 的 .mh-art 段），深浅主题自动适配。 */

function Sparkle({ x, y, s = 1 }) {
  return (
    <path
      className="mh-art__spark"
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 -9 C1.2 -2.4 2.4 -1.2 9 0 C2.4 1.2 1.2 2.4 0 9 C-1.2 2.4 -2.4 1.2 -9 0 C-2.4 -1.2 -1.2 -2.4 0 -9 Z"
    />
  )
}

function Pedestal({ cx = 200, cy, rx = 150 }) {
  return (
    <g>
      <ellipse className="mh-art__shadow" cx={cx} cy={cy + 22} rx={rx + 10} ry={16} />
      <path className="mh-art__base-side" d={`M${cx - rx} ${cy} v14 a${rx} 24 0 0 0 ${rx * 2} 0 v-14 Z`} />
      <ellipse className="mh-art__base" cx={cx} cy={cy} rx={rx} ry={24} />
      <ellipse className="mh-art__base-shine" cx={cx - rx * 0.25} cy={cy - 6} rx={rx * 0.45} ry={7} />
    </g>
  )
}

function Hero() {
  // viewBox 400 × 520；封蜡圆心 (200, 360) → seal = [0.5, 0.692]
  return (
    <svg viewBox="0 0 400 520" className="mh-art" aria-hidden focusable="false">
      <Pedestal cy={462} />
      {/* 背板 + 掀开的封口 */}
      <rect className="mh-art__paper mh-art__edge" x="70" y="232" width="260" height="196" rx="12" />
      <path className="mh-art__flap mh-art__edge" d="M72 240 L200 96 L328 240 Z" strokeLinejoin="round" />
      {/* 抽出一半的信纸：几行字 + 一枚验证码胶囊 */}
      <g className="mh-art__letter-g">
        <rect className="mh-art__letter" x="100" y="150" width="200" height="200" rx="8" />
        <rect className="mh-art__line" x="124" y="178" width="118" height="8" rx="4" />
        <rect className="mh-art__line" x="124" y="198" width="152" height="8" rx="4" />
        <rect className="mh-art__code" x="124" y="222" width="104" height="26" rx="13" />
        <rect className="mh-art__code-dot" x="136" y="232" width="6" height="6" rx="3" />
        <rect className="mh-art__code-dot" x="148" y="232" width="6" height="6" rx="3" />
        <rect className="mh-art__code-dot" x="160" y="232" width="6" height="6" rx="3" />
        <rect className="mh-art__code-dot" x="172" y="232" width="6" height="6" rx="3" />
        <rect className="mh-art__line" x="124" y="262" width="136" height="8" rx="4" />
      </g>
      {/* 前片（口袋）*/}
      <path
        className="mh-art__paper mh-art__edge"
        d="M70 300 L200 382 L330 300 L330 416 Q330 428 318 428 L82 428 Q70 428 70 416 Z"
        strokeLinejoin="round"
      />
      <path className="mh-art__fold" d="M70 418 L168 360 M330 418 L232 360" />
      {/* 封蜡 + 呼吸光 */}
      <circle className="mh-art__glow" cx="200" cy="360" r="46" />
      <circle className="mh-art__seal" cx="200" cy="360" r="21" />
      <circle className="mh-art__seal-ring" cx="200" cy="360" r="13" />
      <Sparkle x={52} y={176} />
      <Sparkle x={344} y={110} s={0.8} />
      <Sparkle x={344} y={300} s={0.55} />
    </svg>
  )
}

function Search() {
  // viewBox 400 × 400：信封举高 + 放大镜，「我把信翻出来找找」
  return (
    <svg viewBox="0 0 400 400" className="mh-art" aria-hidden focusable="false">
      <Pedestal cy={322} rx={130} />
      <g transform="rotate(-8 190 210)">
        <rect className="mh-art__paper mh-art__edge" x="70" y="140" width="230" height="150" rx="12" />
        <path className="mh-art__flap mh-art__edge" d="M74 146 L185 226 L296 146" strokeLinejoin="round" />
        <path className="mh-art__fold" d="M74 284 L160 222 M296 284 L210 222" />
        <circle className="mh-art__seal" cx="185" cy="226" r="15" />
        <circle className="mh-art__seal-ring" cx="185" cy="226" r="9" />
      </g>
      <g className="mh-art__lens-g">
        <line className="mh-art__handle" x1="318" y1="150" x2="356" y2="196" />
        <circle className="mh-art__lens" cx="290" cy="116" r="44" />
        <path className="mh-art__lens-shine" d="M262 104 A30 30 0 0 1 284 84" />
      </g>
      <circle className="mh-art__dot" cx="118" cy="96" r="5" />
      <circle className="mh-art__dot" cx="140" cy="80" r="6.5" />
      <circle className="mh-art__dot" cx="166" cy="70" r="8" />
      <Sparkle x={52} y={210} s={0.7} />
    </svg>
  )
}

function Wait() {
  // viewBox 400 × 400：一摞信，最上面那封的封蜡在呼吸
  return (
    <svg viewBox="0 0 400 400" className="mh-art" aria-hidden focusable="false">
      <Pedestal cy={348} rx={140} />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${i * 6 - 6} ${-i * 42}) rotate(${[-3, 2, -1][i]} 200 300)`}>
          <rect className="mh-art__paper mh-art__edge" x="76" y="252" width="248" height="78" rx="10" />
          <path className="mh-art__flap mh-art__edge" d="M80 256 L200 300 L320 256" strokeLinejoin="round" />
        </g>
      ))}
      <circle className="mh-art__glow" cx="198" cy="212" r="34" />
      <circle className="mh-art__seal" cx="198" cy="212" r="14" />
      <circle className="mh-art__seal-ring" cx="198" cy="212" r="8" />
      <circle className="mh-art__dot" cx="262" cy="118" r="5" />
      <circle className="mh-art__dot" cx="282" cy="98" r="6.5" />
      <circle className="mh-art__dot" cx="306" cy="80" r="8" />
    </svg>
  )
}

const POSES = { hero: Hero, search: Search, wait: Wait }

export function EnvelopeArt({ pose = 'hero' }) {
  const Art = POSES[pose] || Hero
  return <Art />
}
