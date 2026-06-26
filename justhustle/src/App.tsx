import { useEffect, useState, useRef } from 'react';
import { HandwritingTitle } from './HandwritingTitle';

function App() {
  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [trails, setTrails] = useState<{ id: number; x: number; y: number; opacity: number }[]>([]);
  const trailIdRef = useRef(0);

  const [buttonText, setButtonText] = useState('Know More');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const buttonContainerRef = useRef<HTMLDivElement>(null);
  const buttonPositionRef = useRef({ x: 0, y: 0 });
  const buttonTargetRef = useRef({ x: 0, y: 0 });
  const homeCenterRef = useRef({ x: 0, y: 0 });
  const mouseRef = useRef({ x: 0, y: 0 });
  const wasFleeingRef = useRef(false);
  const isEngagedRef = useRef(false);
  const textTimersRef = useRef<{
    keep?: ReturnType<typeof setTimeout>;
    harder?: ReturnType<typeof setTimeout>;
  }>({});

  const mainText = 'justhustle.in';

  const quotes = [
    '"Don\'t go to sleep. Work until you\'re exhausted and then work some more."',
    '"Anyone can start something. The hard part is finishing it."',
    '"The only time success comes before work is in the dictionary."',
    '"Winners don\'t make excuses."',
    '"It\'s not about how bad you want it. It\'s about how hard you\'re willing to work for it."',
    '"Success is not final, failure is not fatal: it is the courage to continue that counts."',
  ];

  const authors = [
    '— Harvey Specter',
    '— Harvey Specter',
    '— Harvey Specter',
    '— Harvey Specter',
    '— Harvey Specter',
    '— Winston Churchill',
  ];

  useEffect(() => {
    const currentQuote = quotes[currentQuoteIndex];
    let timeout: NodeJS.Timeout;

    if (!isDeleting) {
      if (displayedText.length < currentQuote.length) {
        timeout = setTimeout(() => {
          setDisplayedText(currentQuote.slice(0, displayedText.length + 1));
        }, 38);
      } else {
        timeout = setTimeout(() => {
          setIsDeleting(true);
        }, 3200);
      }
    } else {
      if (displayedText.length > 0) {
        timeout = setTimeout(() => {
          setDisplayedText(displayedText.slice(0, -1));
        }, 16);
      } else {
        setIsDeleting(false);
        setCurrentQuoteIndex((prev) => (prev + 1) % quotes.length);
      }
    }

    return () => clearTimeout(timeout);
  }, [displayedText, isDeleting, currentQuoteIndex]);

  useEffect(() => {
    const updateHomeCenter = () => {
      if (!buttonContainerRef.current) return;
      const rect = buttonContainerRef.current.getBoundingClientRect();
      homeCenterRef.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    };

    updateHomeCenter();
    window.addEventListener('resize', updateHomeCenter);

    const handleMouseMove = (e: MouseEvent) => {
      const newTrail = {
        id: trailIdRef.current++,
        x: e.clientX,
        y: e.clientY,
        opacity: 1,
      };
      setTrails(prev => [...prev.slice(-18), newTrail]);
      setCursorPos({ x: e.clientX, y: e.clientY });
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', updateHomeCenter);
    };
  }, []);

  useEffect(() => {
    const ACTIVATION_RADIUS = 130;
    const RELEASE_RADIUS = 280;
    const LERP = 0.14;
    const RETURN_LERP = 0.1;

    const clearTextTimers = () => {
      if (textTimersRef.current.keep) clearTimeout(textTimersRef.current.keep);
      if (textTimersRef.current.harder) clearTimeout(textTimersRef.current.harder);
      textTimersRef.current = {};
    };

    const resetEngagement = () => {
      clearTextTimers();
      isEngagedRef.current = false;
      setButtonText('Know More');
    };

    const startEngagementTimers = () => {
      if (isEngagedRef.current) return;
      isEngagedRef.current = true;

      textTimersRef.current.keep = setTimeout(() => {
        setButtonText('Keep Hustling');
      }, 1000);

      textTimersRef.current.harder = setTimeout(() => {
        setButtonText('Hustle Harder');
      }, 3000);
    };

    const clampPosition = (x: number, y: number) => {
      const maxX = window.innerWidth * 0.38;
      const maxY = window.innerHeight * 0.32;
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    };

    const applyTransform = (x: number, y: number) => {
      if (buttonRef.current) {
        buttonRef.current.style.transform = `translate(${x}px, ${y}px)`;
      }
    };

    const animateButton = () => {
      const mouse = mouseRef.current;
      const pos = buttonPositionRef.current;
      const home = homeCenterRef.current;

      const btnCenterX = home.x + pos.x;
      const btnCenterY = home.y + pos.y;

      const dx = mouse.x - btnCenterX;
      const dy = mouse.y - btnCenterY;
      const dist = Math.hypot(dx, dy);

      const distMouseToHome = Math.hypot(mouse.x - home.x, mouse.y - home.y);
      const isCursorAway = distMouseToHome > RELEASE_RADIUS;
      const isFleeing = !isCursorAway && dist < ACTIVATION_RADIUS && dist > 0.5;

      let target = buttonTargetRef.current;

      if (isCursorAway) {
        target = { x: 0, y: 0 };
      } else if (isFleeing) {
        const intensity = 1 - dist / ACTIVATION_RADIUS;
        const fleeSpeed = 3 + intensity * 16;
        const nx = -dx / dist;
        const ny = -dy / dist;

        target = clampPosition(
          pos.x + nx * fleeSpeed,
          pos.y + ny * fleeSpeed,
        );
      }

      buttonTargetRef.current = target;

      if (isFleeing && !wasFleeingRef.current) {
        startEngagementTimers();
      }
      wasFleeingRef.current = isFleeing;

      const ease = isCursorAway ? RETURN_LERP : LERP;
      let newX = pos.x + (target.x - pos.x) * ease;
      let newY = pos.y + (target.y - pos.y) * ease;

      if (isCursorAway && Math.hypot(newX, newY) < 0.4) {
        newX = 0;
        newY = 0;
        buttonTargetRef.current = { x: 0, y: 0 };
        if (isEngagedRef.current) {
          resetEngagement();
        }
      }

      buttonPositionRef.current = { x: newX, y: newY };
      applyTransform(newX, newY);

      requestAnimationFrame(animateButton);
    };

    const animationId = requestAnimationFrame(animateButton);
    return () => {
      cancelAnimationFrame(animationId);
      clearTextTimers();
    };
  }, []);

  useEffect(() => {
    const animateTrails = () => {
      setTrails(prev => prev.map(t => ({ ...t, opacity: t.opacity * 0.82 })).filter(t => t.opacity > 0.04));
      requestAnimationFrame(animateTrails);
    };
    const animationId = requestAnimationFrame(animateTrails);
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center overflow-hidden relative" style={{ backgroundColor: '#080a0f' }}>

      {/* Grain overlay */}
      <div className="grain-overlay" />

      {/* Ambient orbs */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, rgba(180,83,9,0.06) 40%, transparent 70%)',
          top: '10%',
          left: '15%',
          filter: 'blur(40px)',
          animation: 'float 8s ease-in-out infinite',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.10) 0%, rgba(37,99,235,0.05) 40%, transparent 70%)',
          bottom: '10%',
          right: '10%',
          filter: 'blur(50px)',
          animation: 'float 10s ease-in-out infinite',
          animationDelay: '3s',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: '300px',
          height: '300px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245,158,11,0.07) 0%, transparent 70%)',
          top: '55%',
          left: '5%',
          filter: 'blur(30px)',
          animation: 'float 12s ease-in-out infinite',
          animationDelay: '1.5s',
        }}
      />

      {/* Cursor trail — amber */}
      <div className="hidden md:block">
        {trails.map(trail => (
          <div
            key={trail.id}
            className="fixed w-5 h-5 rounded-full pointer-events-none z-50"
            style={{
              left: trail.x - 10,
              top: trail.y - 10,
              background: `radial-gradient(circle, rgba(245, 158, 11, ${trail.opacity * 0.55}) 0%, rgba(180, 83, 9, ${trail.opacity * 0.25}) 50%, transparent 70%)`,
              filter: 'blur(2px)',
            }}
          />
        ))}
      </div>

      {/* Custom cursor */}
      <div
        className="fixed w-7 h-7 rounded-full pointer-events-none z-[60] mix-blend-screen hidden md:block"
        style={{
          left: cursorPos.x - 14,
          top: cursorPos.y - 14,
          background: 'radial-gradient(circle, rgba(245,158,11,0.95) 0%, rgba(180,83,9,0.6) 50%, transparent 70%)',
          boxShadow: '0 0 18px rgba(245,158,11,0.6), 0 0 36px rgba(245,158,11,0.25)',
          transition: 'transform 0.08s ease-out',
        }}
      />

      {/* Top accent line */}
      <div className="absolute top-0 left-0 w-full h-px" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(245,158,11,0.4) 50%, transparent 100%)' }} />

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center px-6 w-full">

        {/* Eyebrow */}
        <div className="flex items-center gap-4 mb-10 animate-fade-in-up">
          <div className="divider-line" />
          <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic', color: 'rgba(245,158,11,1)', fontSize: '0.95rem', letterSpacing: '0.18em' }}>
            hustle. build. repeat.
          </span>
          <div className="divider-line" />
        </div>

        {/* Handwriting title */}
        <div className="animate-fade-in-up animate-delay-200">
          <HandwritingTitle text={mainText} />
        </div>

        {/* Quote */}
        <div className="h-28 flex flex-col items-center justify-center mt-6 animate-fade-in-up animate-delay-400">
          <p
            className="quote-text text-xl md:text-2xl max-w-xl text-center leading-relaxed"
            style={{ color: 'rgba(254,243,199,0.95)', fontStyle: 'italic', fontWeight: 300 }}
          >
            {displayedText}
            <span
              className="inline-block w-px h-5 ml-1 align-middle animate-pulse"
              style={{ background: 'rgba(245,158,11,0.8)' }}
            />
          </p>
          {displayedText.length > 0 && !isDeleting && displayedText === quotes[currentQuoteIndex] && (
            <p
              className="quote-text mt-3 text-sm tracking-widest"
              style={{ color: 'rgba(245,158,11,0.5)', fontStyle: 'normal', letterSpacing: '0.15em' }}
            >
              {authors[currentQuoteIndex]}
            </p>
          )}
        </div>

        {/* Fleeing button */}
        <div
          ref={buttonContainerRef}
          className="h-20 mt-8 flex items-center justify-center w-full max-w-md animate-fade-in-up animate-delay-600"
        >
          <button
            ref={buttonRef}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="hustle-btn relative px-10 py-3.5 rounded-full font-semibold text-sm text-amber-950 overflow-hidden select-none will-change-transform pointer-events-none tracking-wider uppercase"
            style={{ transform: 'translate(0px, 0px)', letterSpacing: '0.1em' }}
            onClick={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
          >
            {buttonText}
          </button>
        </div>
      </div>

      {/* Bottom accent line */}
      <div className="absolute bottom-0 left-0 w-full h-px" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.3) 50%, transparent 100%)' }} />
    </div>
  );
}

export default App;
