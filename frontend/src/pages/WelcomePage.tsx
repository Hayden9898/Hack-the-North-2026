import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MotionConfig, motion, useReducedMotion } from 'motion/react'
import { ArrowDown, ArrowRight, ArrowUpRight, Fingerprint, RotateCcw } from 'lucide-react'
import './welcome.css'

/** An editorial front door. The operational console stays at / and never loads this visual. */
export function WelcomePage() {
  const [tilt, setTilt] = useState(-8)
  const reduceMotion = useReducedMotion()
  useEffect(() => {
    document.title = 'Log & Order · Evidence before inference'
  }, [])
  return (
    <MotionConfig reducedMotion="user">
      <div className="welcome">
        <a className="skip-link" href="#welcome-content">
          Skip to content
        </a>
        <header className="welcome-nav">
          <Link to="/welcome" className="welcome-wordmark">
            log<span>&</span>order<span className="welcome-label">BEHAVIORAL DETECTION</span>
          </Link>
          <Link to="/" className="welcome-nav-link">
            Open console <ArrowUpRight size={15} />
          </Link>
        </header>
        <main id="welcome-content">
          <section className="welcome-hero" aria-labelledby="welcome-title">
            <div className="welcome-copy">
              <span className="welcome-kicker">EVIDENCE BEFORE INFERENCE</span>
              <h1 id="welcome-title">
                Less noise.
                <br />
                More evidence.
              </h1>
              <p>
                Find the change that matters in your access logs. Follow each detection back to the events,
                rules, and facts behind it.
              </p>
              <div className="welcome-actions">
                <Link to="/" className="welcome-primary">
                  Enter workspace <ArrowRight size={18} />
                </Link>
                <a href="#workflow" className="welcome-secondary">
                  How it works <ArrowDown size={16} />
                </a>
              </div>
              <div className="welcome-principles">
                <span>Independent rules</span>
                <span>Frozen models</span>
                <span>Verifiable facts</span>
              </div>
            </div>
            <div className="badge-stage">
              <div className="badge-grain" aria-hidden="true" />
              <motion.div
                className="operator-badge-assembly"
                drag
                dragSnapToOrigin
                dragConstraints={{ left: -48, right: 48, top: -24, bottom: 40 }}
                dragElastic={0.12}
                animate={{ rotate: reduceMotion ? 0 : tilt }}
                transition={{ type: 'spring', stiffness: 160, damping: 22 }}
                whileDrag={reduceMotion ? undefined : { scale: 1.025, cursor: 'grabbing' }}
                tabIndex={0}
                role="group"
                aria-label="Interactive operator badge"
                aria-describedby="badge-instructions"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault()
                    setTilt((value) =>
                      Math.max(-18, Math.min(18, value + (event.key === 'ArrowLeft' ? -4 : 4))),
                    )
                  } else if (event.key === 'Home') {
                    event.preventDefault()
                    setTilt(-8)
                  }
                }}
              >
                <div className="badge-strap" aria-hidden="true">
                  <span>LOG & ORDER / EVIDENCE BEFORE INFERENCE /</span>
                </div>
                <div className="badge-clip" aria-hidden="true" />
                <div className="operator-badge">
                  <div className="badge-slot" aria-hidden="true" />
                  <div className="badge-topline">
                    <span>LOG & ORDER</span>
                    <span>01 / OPERATOR</span>
                  </div>
                  <div className="badge-art" aria-hidden="true">
                    <Fingerprint strokeWidth={0.65} />
                  </div>
                  <div className="badge-title">
                    Follow
                    <br />
                    the evidence.
                  </div>
                  <div className="badge-bottom">
                    <span>
                      OBSERVE.
                      <br />
                      INVESTIGATE. VERIFY.
                    </span>
                    <ArrowUpRight size={27} />
                  </div>
                  <div className="badge-barcode" aria-hidden="true" />
                </div>
              </motion.div>
              <div className="badge-controls">
                <span id="badge-instructions">Drag to explore · ← → to tilt</span>
                <button onClick={() => setTilt(-8)} aria-label="Reset badge position">
                  <RotateCcw size={14} /> Reset
                </button>
              </div>
            </div>
          </section>
          <section className="welcome-workflow" id="workflow" aria-labelledby="workflow-title">
            <div className="workflow-heading">
              <span className="welcome-kicker">THE INVESTIGATION WORKFLOW</span>
              <h2 id="workflow-title">A clear path from signal to source.</h2>
            </div>
            <div className="workflow-rows">
              {[
                [
                  '01',
                  'Connect a source',
                  'Import your HTTP access logs. Inspect data quality before starting an execution.',
                  '/sources',
                ],
                [
                  '02',
                  'Run the detector',
                  'Evaluate independent rules alongside a frozen behavioral model. Track progress and processing health.',
                  '/runs',
                ],
                [
                  '03',
                  'Inspect the evidence',
                  'Investigate versioned incidents. Recompute supporting facts and record an informed review.',
                  '/incidents',
                ],
              ].map(([number, title, description, to]) => (
                <Link className="workflow-row" to={to} key={number}>
                  <span className="workflow-number">{number}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                  <ArrowUpRight size={20} />
                </Link>
              ))}
            </div>
          </section>
        </main>
        <footer className="welcome-footer">
          <span>LOG & ORDER</span>
          <p>AI proposes. Evidence decides.</p>
          <Link to="/integrations">
            Application observability <ArrowUpRight size={14} />
          </Link>
        </footer>
      </div>
    </MotionConfig>
  )
}
