import { ArrowRight, Check } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { SiteNav } from '@/components/SiteNav'
import { TowerMark } from '@/components/Wordmark'
import { cn } from '@/lib/cn'
import { DATASET, EXHIBIT, INCIDENTS, RULES, RUN } from './data'

/*
 * Landing page, laid out after the v0 "Pointer AI" template: dark page, mint glow behind the
 * hero and the closing call to action, centred type, a product still under the headline, a
 * bento of features, three plan-style cards, a quote band, an FAQ, a footer with columns.
 * Only the words and the product still are ours. The page is always dark, whatever the console
 * theme is set to.
 */

const START = '/app'

export function Landing() {
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash])
  return (
    <div className="min-h-dvh bg-[#0a0a0a] text-white [font-family:var(--font-sans)]">
      <SiteNav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Quote />
        <Cta />
      </main>
      <Footer />
    </div>
  )
}

/* ------------------------------------------------------------------ hero */

function Glow({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)}>
      {/* grid of faint squares */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(70%_70%_at_50%_40%,black,transparent)]" />
      {/* mint glow, bottom right */}
      <div className="absolute right-[-10%] bottom-[-20%] h-[40rem] w-[52rem] rounded-full bg-[radial-gradient(closest-side,rgba(170,240,214,0.55),rgba(88,196,160,0.25)_45%,transparent_75%)] blur-2xl" />
    </div>
  )
}

function Hero() {
  const total = RUN.warmupNormal + RUN.visibleNormal + RUN.visibleSuspicious + RUN.visibleHighRisk
  return (
    <section className="relative isolate overflow-hidden">
      <Glow />
      <div className="mx-auto w-full max-w-[72rem] px-6 pt-24 pb-20 text-center sm:pt-32">
        <h1 className="mx-auto max-w-[14ch] text-[2.75rem] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[4rem] lg:text-[4.75rem]">
          See the Breach Before the Breach
        </h1>
        <p className="mx-auto mt-6 max-w-[46ch] text-[1.0625rem] leading-relaxed text-white/60 sm:text-[1.125rem]">
          WatchTower replays your access logs in causal order, flags what breaks pattern, and shows the exact query
          behind every claim it makes.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <Link to={START} className="no-underline rounded-full bg-white px-6 py-3 text-[0.9375rem] font-medium text-black hover:bg-white/90">
            Start a run
          </Link>
          <a href="#features" className="no-underline rounded-full border border-white/15 px-6 py-3 text-[0.9375rem] font-medium text-white/80 hover:border-white/30 hover:text-white">
            See features
          </a>
        </div>

        {/* product still */}
        <div className="mx-auto mt-20 max-w-[64rem] text-left">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_40px_120px_-30px_rgba(120,220,180,0.35)]">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0f1013]">
              <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-2.5">
                <span className="flex gap-1.5" aria-hidden>
                  <span className="size-2.5 rounded-full bg-white/15" />
                  <span className="size-2.5 rounded-full bg-white/15" />
                  <span className="size-2.5 rounded-full bg-white/15" />
                </span>
                <span className="ms-2 font-mono text-[0.6875rem] text-white/40">/app/runs/{RUN.id.slice(0, 8)} · findings under cutoff #{total.toLocaleString()}</span>
              </div>
              <div className="grid gap-px bg-white/[0.06] md:grid-cols-[minmax(0,1fr)_16rem]">
                <div className="bg-[#0f1013] p-5">
                  <p className="text-[0.9375rem] font-medium">Findings</p>
                  <ul className="mt-3 grid gap-2">
                    {INCIDENTS.map((i) => (
                      <li key={i.docket} className={cn('rounded-lg border bg-white/[0.02] px-3.5 py-3', i.verdict === 'high_risk' ? 'border-red-400/30' : 'border-white/10')}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn('rounded px-1.5 py-0.5 font-mono text-[0.625rem] font-medium uppercase tracking-wider', i.verdict === 'high_risk' ? 'bg-red-400/15 text-red-300' : 'bg-amber-400/15 text-amber-300')}>
                            {i.verdict.replace('_', ' ')}
                          </span>
                          {i.rules.map((r) => (
                            <span key={r} className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[0.625rem] text-white/50">{r}</span>
                          ))}
                          <span className="ms-auto font-mono text-[0.6875rem] text-white/35">{i.when}</span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[0.875rem] leading-snug text-white/90">{i.headline}</p>
                        <p className="mt-1 font-mono text-[0.6875rem] text-white/40">{i.key}</p>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-[#0f1013] p-5">
                  <p className="text-[0.9375rem] font-medium">This run</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-1">
                    <Stat label="Lines replayed" value={DATASET.lines.toLocaleString()} />
                    <Stat label="Rejected" value={String(DATASET.rejects)} />
                    <Stat label="Incidents" value={String(RUN.incidentsTotal)} />
                    <Stat label="Denials proved" value={String(EXHIBIT.count)} />
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] text-white/45">{label}</dt>
      <dd className="text-[1.375rem] leading-tight font-semibold tabular-nums tracking-tight">{value}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------ features (bento) */

const FEATURES = [
  { title: 'Causal replay', body: 'Requests are scored in the order they arrived, under a moving cutoff. A verdict only uses what was known at that moment.' },
  { title: 'Deterministic rules', body: 'Five rules, same input, same answer. No model has to be trusted for a finding to exist.' },
  { title: 'The query behind every claim', body: 'Each fact stores the query that produced it. The API reruns it on request and says whether the number still holds.' },
  { title: 'Versioned incidents', body: 'When an incident escalates the earlier version stays, so you can read what was believed before more was known.' },
  { title: 'Unknowns written down', body: 'What the logs cannot establish is listed beside what they can. A login proves a login, not who typed it.' },
  { title: 'Containment with approval', body: 'Dry run, approve, verify, roll back. The assistant picks a playbook; it never picks a target.' },
]

function Features() {
  return (
    <section id="features" className="scroll-mt-20 py-24">
      <div className="mx-auto w-full max-w-[72rem] px-6">
        <div className="mx-auto max-w-[40rem] text-center">
          <h2 className="text-[2rem] leading-tight font-semibold tracking-[-0.025em] sm:text-[2.5rem]">Built to be checked, not believed</h2>
          <p className="mt-4 text-[1.0625rem] text-white/55">Every step a reviewer might question is stored, versioned and reproducible.</p>
        </div>
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:bg-white/[0.05]">
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-[#9fe6cb]/15 text-[#9fe6cb]">
                <Check className="size-4" />
              </span>
              <h3 className="mt-4 text-[1.0625rem] font-semibold">{f.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-white/55">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ how it works */

const STAGES = [
  { id: 'import', title: 'Import', body: 'An Apache access log is streamed in and every line is validated. Rejected lines are kept and shown, never dropped.' },
  { id: 'replay', title: 'Causal replay', body: 'A run walks the file in the order requests arrived. It warms up on history, then scores the visible window under a moving cutoff.' },
  { id: 'rules', title: 'Rules and scoring', body: 'Five deterministic rules fire on each request. A model adds a rarity percentile, but a finding never depends on it.' },
  { id: 'incidents', title: 'Incidents', body: 'Matches are grouped into versioned incidents. Each fact stores the query that produced it so the count can be recomputed.' },
  { id: 'act', title: 'Investigate and contain', body: 'Open a finding, follow the proof to the raw lines, then dry run, approve, verify or roll back a containment action.' },
]

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-16 border-y border-white/[0.06] bg-white/[0.02] py-24">
      <div className="mx-auto w-full max-w-[72rem] px-6">
        <div className="mx-auto max-w-[44rem] text-center">
          <h2 className="text-[2rem] leading-tight font-semibold tracking-[-0.025em] sm:text-[2.5rem]">How it works</h2>
          <p className="mt-4 text-[1.0625rem] text-white/55">
            From a raw log file to a finding you can defend, in five stages. Nothing is scored out of order and nothing is claimed without the query that proves it.
          </p>
        </div>

        <Flow />

        <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {STAGES.map((s, i) => (
            <li key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-[#9fe6cb] font-mono text-[0.75rem] font-medium text-black">{i + 1}</span>
              <h3 className="mt-3 text-[1rem] font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[0.875rem] leading-relaxed text-white/55">{s.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-[1.0625rem] font-semibold">The five rules</h3>
            <ul className="mt-4 space-y-3">
              {RULES.map(([id, text]) => (
                <li key={id} className="flex gap-3 text-[0.9375rem] text-white/80">
                  <span className="mt-0.5 shrink-0 rounded border border-white/15 px-1.5 font-mono text-[0.6875rem] text-white/60">{id}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-[1.0625rem] font-semibold">Why the cutoff matters</h3>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-white/60">
              Every verdict is made at a point in the replay called the cutoff. The detector can only use requests that arrived before it, so a finding
              reflects what was knowable at the time, not what the whole file reveals in hindsight. When later requests change the picture, the incident
              gets a new version and the old one is kept.
            </p>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-white/60">
              The sample run replays {DATASET.lines.toLocaleString()} lines from {DATASET.from} to {DATASET.to}, warms up on {RUN.warmupNormal.toLocaleString()} of them, and opens {RUN.incidentsTotal} incidents in the visible window.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/** The pipeline as a diagram: six nodes, five arrows, one loop back for versioning. */
function Flow() {
  const nodes = ['Log file', 'Import & validate', 'Causal replay', 'Rules + model', 'Incidents', 'Investigate & contain']
  return (
    <div className="mt-14 overflow-x-auto">
      <svg
        viewBox="0 0 1160 190"
        className="mx-auto h-auto w-full min-w-[840px] max-w-[72rem]"
        role="img"
        aria-label="Pipeline: log file, import and validate, causal replay, rules and model, incidents, investigate and contain. Incidents loop back to the replay as new versions."
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 Z" fill="#9fe6cb" />
          </marker>
        </defs>
        {nodes.map((label, i) => {
          const x = 20 + i * 190
          const first = i === 0
          return (
            <g key={label}>
              <rect
                x={x}
                y="60"
                width="160"
                height="56"
                rx="12"
                fill={first ? 'rgba(255,255,255,0.06)' : 'rgba(159,230,203,0.08)'}
                stroke={first ? 'rgba(255,255,255,0.18)' : 'rgba(159,230,203,0.45)'}
              />
              <text x={x + 80} y="93" textAnchor="middle" fill="#ffffff" fontSize="15" fontWeight="500">
                {label}
              </text>
              {i < nodes.length - 1 ? <line x1={x + 162} y1="88" x2={x + 188} y2="88" stroke="#9fe6cb" strokeWidth="2" markerEnd="url(#arrow)" /> : null}
            </g>
          )
        })}
        <path d="M 860 118 C 860 165, 480 165, 480 118" fill="none" stroke="rgba(159,230,203,0.6)" strokeWidth="2" strokeDasharray="6 5" markerEnd="url(#arrow)" />
        <text x="670" y="176" textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="13">
          later requests re-open an incident as a new version
        </text>
        <line x1="590" y1="22" x2="590" y2="52" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeDasharray="3 3" />
        <text x="590" y="16" textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="13">
          cutoff moves forward
        </text>
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ quote band */

function Quote() {
  return (
    <section className="py-24">
      <div className="mx-auto w-full max-w-[56rem] px-6 text-center">
        <p className="text-[1.5rem] leading-snug font-medium text-balance sm:text-[2rem]">
          “The account was refused this file {EXHIBIT.count} times over eight months. Then it was served.”
        </p>
        <p className="mt-6 text-[0.9375rem] text-white/50">
          Fact {EXHIBIT.factId} · recorded {EXHIBIT.proof.recorded}, recomputed {EXHIBIT.proof.recomputed} · from the sample run
        </p>
        <Link
          to={`/app/runs/${RUN.id}/incidents/${EXHIBIT.incidentId}`}
          className="no-underline mt-6 inline-flex items-center gap-1.5 text-[0.9375rem] text-[#9fe6cb] hover:underline"
        >
          Open the incident <ArrowRight className="size-4" />
        </Link>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ cta + footer */

function Cta() {
  return (
    <section className="relative isolate overflow-hidden py-28">
      <Glow />
      <div className="mx-auto w-full max-w-[72rem] px-6 text-center">
        <h2 className="mx-auto max-w-[18ch] text-[2.25rem] leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-[3rem]">
          Start your first run in under a minute
        </h2>
        <p className="mx-auto mt-4 max-w-[44ch] text-[1.0625rem] text-white/55">
          The sample dataset is already imported. Open the console, pick the dataset, and start a run.
        </p>
        <Link to={START} className="no-underline mt-8 inline-flex rounded-full bg-white px-6 py-3 text-[0.9375rem] font-medium text-black hover:bg-white/90">
          Open console
        </Link>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto grid w-full max-w-[72rem] gap-10 px-6 py-14 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <TowerMark className="size-8" />
            <span className="text-[1.125rem] font-semibold tracking-tight">WatchTower</span>
          </div>
          <p className="mt-3 max-w-[36ch] text-[0.9375rem] text-white/50">Access-log investigation with the proof attached. Built for Hack the North 2026.</p>
        </div>
        <div>
          <p className="text-[0.8125rem] font-medium text-white/40">Product</p>
          <ul className="mt-3 space-y-2 text-[0.9375rem] text-white/70">
            <li><a href="#features" className="hover:text-white">Features</a></li>
            <li><a href="#how" className="hover:text-white">How it works</a></li>
          </ul>
        </div>
        <div>
          <p className="text-[0.8125rem] font-medium text-white/40">Console</p>
          <ul className="mt-3 space-y-2 text-[0.9375rem] text-white/70">
            <li><Link to={START} className="hover:text-white">Start a run</Link></li>
            <li><Link to="/app" className="hover:text-white">Runs</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/[0.06] py-6 text-center text-[0.8125rem] text-white/35">© 2026 WatchTower</div>
    </footer>
  )
}
