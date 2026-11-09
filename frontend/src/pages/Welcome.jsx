import { ArrowDown, ArrowRight, BarChart3, Beer, Boxes, ShieldCheck, ShoppingCart, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';

const features = [
  { icon: Boxes, title: 'Stock you can trust', description: 'Track products, packaging, and stock movements with a clear view of what is on hand.' },
  { icon: ShoppingCart, title: 'Sales that stay in sync', description: 'Record sales, payments, and customer balances together in one straightforward workflow.' },
  { icon: TrendingUp, title: 'A clearer picture of today', description: 'Bring sales, costs, and expenses into one view to make more confident daily decisions.' },
];

export default function Welcome() {
  return (
    <main className="welcome-page">
      <header className="welcome-nav">
        <Link className="welcome-brand" to="/" aria-label="Umucyo bar home">
          <span className="welcome-brand-mark"><Beer size={21} /></span>
          <span><b>Umucyo bar</b><small>STOCK &amp; SALES</small></span>
        </Link>
        <nav className="welcome-nav-links" aria-label="Main navigation">
          <a href="#features">What you can do</a>
          <Link className="welcome-signin" to="/login">Sign in <ArrowRight size={15} /></Link>
        </nav>
      </header>

      <section className="welcome-hero">
        <div className="welcome-hero-copy">
          <div className="welcome-eyebrow"><span /> BUILT FOR THE BUSINESS YOU RUN EVERY DAY</div>
          <h1>Run your bar with <em>more clarity.</em></h1>
          <p>Keep stock, sales, and cash in step. Umucyo bar brings the details of your day together, so you can spend less time chasing numbers and more time growing your business.</p>
          <div className="welcome-actions">
            <Link to="/login" className="welcome-primary">Get started <ArrowRight size={17} /></Link>
            <a href="#features" className="welcome-secondary">Explore the workspace <ArrowDown size={15} /></a>
          </div>
          <div className="welcome-trust"><ShieldCheck size={16} /><span>Your workspace is private to your business</span></div>
        </div>

        <div className="welcome-preview">
          <section className="welcome-chart-card" aria-label="Static sample bar chart of weekly activity">
            <header className="welcome-chart-card-header">
              <span className="welcome-chart-card-icon"><BarChart3 size={17} /></span>
              <span className="welcome-chart-card-title"><small>UMUCYO BAR · BUSINESS OVERVIEW</small><b>Weekly activity</b></span>
              <span className="welcome-chart-card-sample"><i /> STATIC GRAPH</span>
            </header>
            <div className="welcome-chart-plot" role="img" aria-label="Static grouped bar chart comparing activity this week and last week, by day.">
              <div className="welcome-chart-grid">
                {[0, 1, 2, 3, 4].map((line) => <i key={line} />)}
              </div>
              <div className="welcome-chart-groups">
                {[
                  { day: 'MON', current: 48, previous: 35 },
                  { day: 'TUE', current: 62, previous: 44 },
                  { day: 'WED', current: 54, previous: 46 },
                  { day: 'THU', current: 78, previous: 58 },
                  { day: 'FRI', current: 67, previous: 51 },
                  { day: 'SAT', current: 94, previous: 70 },
                  { day: 'SUN', current: 73, previous: 56 },
                ].map(({ day, current, previous }) => (
                  <div className={`welcome-chart-group${day === 'SAT' ? ' is-highlight' : ''}`} key={day}>
                    <span className="welcome-chart-pair">
                      <i className="welcome-chart-bar previous" style={{ height: `${previous}%` }} />
                      <i className="welcome-chart-bar current" style={{ height: `${current}%` }} />
                    </span>
                    <small>{day}</small>
                  </div>
                ))}
              </div>
            </div>
            <footer className="welcome-chart-card-footer">
              <span><i className="legend-current" /> This week</span>
              <span><i className="legend-previous" /> Previous week</span>
              <span className="welcome-chart-period">MON — SUN</span>
            </footer>
          </section>
          <div className="welcome-chart-note">
            <span><TrendingUp size={16} /></span>
            <b>A clear view of activity across the week.</b>
          </div>
        </div>
        <a className="welcome-scroll" href="#features"><span>SCROLL TO EXPLORE</span><ArrowDown size={14} /></a>
      </section>

      <section className="welcome-features" id="features">
        <div className="welcome-section-heading">
          <span className="welcome-eyebrow"><span /> ONE WORKSPACE. A BETTER-RUN DAY.</span>
          <h2>Everything in its right place.</h2>
          <p>The essential tools to keep your bar moving smoothly, from the first delivery to closing time.</p>
        </div>
        <div className="welcome-feature-grid">
          {features.map(({ icon: Icon, title, description }, index) => (
            <article className="welcome-feature" key={title}>
              <span className="welcome-feature-number">0{index + 1}</span>
              <span className="welcome-feature-icon"><Icon size={20} /></span>
              <h3>{title}</h3>
              <p>{description}</p>
              <ArrowRight className="welcome-feature-arrow" size={17} />
            </article>
          ))}
        </div>
      </section>

      <section className="welcome-cta">
        <div><span className="welcome-eyebrow"><span /> YOUR NEXT SHIFT STARTS HERE</span><h2>A calmer way to run the day.</h2><p>Sign in to your workspace and bring your business into focus.</p></div>
        <Link to="/login" className="welcome-primary">Enter your workspace <ArrowRight size={17} /></Link>
      </section>

      <footer className="welcome-footer">
        <Link className="welcome-brand" to="/" aria-label="Umucyo bar home">
          <span className="welcome-brand-mark"><Beer size={18} /></span>
          <span><b>Umucyo bar</b><small>STOCK &amp; SALES</small></span>
        </Link>
        <span>Made for the people behind the bar. <b>Rwanda</b></span>
        <span>© {new Date().getFullYear()} Umucyo bar</span>
      </footer>
    </main>
  );
}
