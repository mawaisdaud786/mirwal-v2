import { useState } from 'react'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function navigate(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const benefits = [
  ['tag', 'Exclusive Deals', 'Access members-only offers and discounts.'],
  ['heart', 'Save & Compare', 'Save products, compare and choose the best.'],
  ['truck-fast', 'Track Orders', 'Track your orders in real-time and get updates.'],
  ['shield-halved', 'Secure & Safe', 'Your data is 100% protected with top security.'],
]

function Brand() {
  return <button className="auth-brand" type="button" onClick={() => navigate('/')}><span className="brand-mark">M</span><span><b>MIRWAL</b><small>Smart Shopping. Better Living.</small></span></button>
}

function SocialButton({ icon, label, className = '' }) {
  return <button className={`social-button ${className}`} type="button"><FaIcon name={icon} /> <span>{label}</span></button>
}

export default function AuthPage({ initialMode = 'signin' }) {
  const [mode, setMode] = useState(initialMode)
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const isSignUp = mode === 'signup'

  function switchMode(nextMode) {
    setMode(nextMode)
    setMessage('')
    window.history.replaceState({}, '', nextMode === 'signup' ? '/register' : '/login')
  }

  function submit(event) {
    event.preventDefault()
    setMessage(isSignUp ? 'Account created successfully.' : 'Welcome back. You are signed in.')
  }

  return <main className="auth-page"><div className="auth-topbar"><Brand /><div><span>Need help?</span><button type="button"><FaIcon name="headset" /> Help & Support</button><button type="button" onClick={() => navigate('/')}><FaIcon name="house" /> Back to Home</button></div></div><div className="auth-shell"><aside className="auth-pitch"><div><h1>Smart Shopping<br /><span>Starts Here</span></h1><p>Sign in to access the best deals, compare products, track orders and enjoy a smarter way to shop.</p><div className="auth-benefits">{benefits.map(([icon, title, detail]) => <div key={title}><span><FaIcon name={icon} /></span><p><b>{title}</b><small>{detail}</small></p></div>)}</div></div><div className="auth-vignette" aria-hidden="true"><div className="vignette-bag"><strong>M</strong></div><div className="vignette-box" /><div className="vignette-plant">✦</div></div><div className="auth-members"><span className="member-faces"><i>AA</i><i>SK</i><i>UF</i><i>+</i></span><p><b>Join 50,000+ happy shoppers</b><small>and enjoy a better shopping experience.</small></p></div></aside><section className="auth-card"><div className="auth-tabs"><button className={!isSignUp ? 'active' : ''} type="button" onClick={() => switchMode('signin')}>Sign In</button><button className={isSignUp ? 'active' : ''} type="button" onClick={() => switchMode('signup')}>Create Account</button></div><div className="auth-content"><h2>{isSignUp ? 'Create your account' : 'Welcome back!'}</h2><p className="auth-subtitle">{isSignUp ? 'Join Mirwal and shop with confidence' : 'Sign in to continue to Mirwal'}</p><div className="social-row"><SocialButton icon="google" label="Continue with Google" className="google" /><SocialButton icon="facebook" label="Continue with Facebook" className="facebook" /><SocialButton icon="apple" label="Continue with Apple" className="apple" /></div><div className="auth-divider"><span>or</span></div><form onSubmit={submit}>{isSignUp && <label className="auth-field"><span>Full Name</span><div><FaIcon name="user" /><input required placeholder="Enter your full name" /></div></label>}<label className="auth-field"><span>Email or Phone Number</span><div><FaIcon name="envelope" /><input required placeholder="Enter your email or phone number" /></div></label><label className="auth-field"><span>Password {isSignUp && <small>(minimum 8 characters)</small>}</span><div><FaIcon name="lock" /><input required minLength={isSignUp ? 8 : 1} type={showPassword ? 'text' : 'password'} placeholder="Enter your password" /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}><FaIcon name={showPassword ? 'eye-slash' : 'eye'} /></button></div></label>{isSignUp && <label className="auth-field"><span>Confirm Password</span><div><FaIcon name="lock" /><input required minLength="8" type="password" placeholder="Confirm your password" /></div></label>}{!isSignUp && <div className="auth-options"><label><input type="checkbox" /> Remember me</label><button type="button">Forgot Password?</button></div>}<button className="auth-submit" type="submit">{isSignUp ? 'Create Account' : 'Sign In'} <FaIcon name="arrow-right" /></button></form>{message && <p className="auth-message" role="status">{message}</p>}<p className="auth-switch">{isSignUp ? 'Already have an account?' : "Don't have an account?"} <button type="button" onClick={() => switchMode(isSignUp ? 'signin' : 'signup')}>{isSignUp ? 'Sign In' : 'Create Account'}</button></p><div className="auth-trust"><div><FaIcon name="shield-halved" /><p><b>100% Secure</b><small>Your data is safe and encrypted.</small></p></div><div><FaIcon name="rotate-left" /><p><b>Easy Returns</b><small>Hassle-free returns within 7 days.</small></p></div><div><FaIcon name="headset" /><p><b>24/7 Support</b><small>We're here to help you anytime.</small></p></div></div></div></section></div><div className="auth-footer-benefits"><div><FaIcon name="bag-shopping" /><span><b>100% Secure Payments</b><small>Safe & encrypted</small></span></div><div><FaIcon name="truck-fast" /><span><b>7 Days Return</b><small>Easy returns & refunds</small></span></div><div><FaIcon name="box-open" /><span><b>Fast Delivery</b><small>Across Pakistan</small></span></div><div><FaIcon name="headset" /><span><b>24/7 Customer Support</b><small>We're here to help you</small></span></div></div></main>
}
