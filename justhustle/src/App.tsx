import { useEffect, useState, useRef } from 'react';
import { Sparkles } from 'lucide-react';
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
    '"Don\'t go to sleep. Work until you\'re exhausted and then work some more." — Harvey Specter',
    '"Anyone can start something. The hard part is finishing it." — Harvey Specter',
    '"The only time success comes before work is in the dictionary." — Harvey Specter',
    '"Winners don\'t make excuses." — Harvey Specter',
    '"It\'s not about how bad you want it. It\'s about how hard you\'re willing to work for it." — Harvey Specter',
    '"Success is not final, failure is not fatal: it is the courage to continue that counts." — Winston Churchill',
  ];

  useEffect(() => {
    const currentQuote = quotes[currentQuoteIndex];
    let timeout: NodeJS.Timeout;

    if (!isDeleting) {
      if (displayedText.length < currentQuote.length) {
        timeout = setTimeout(() => {
          setDisplayedText(currentQuote.slice(0, displayedText.length + 1));
        }, 40);
      } else {
        timeout = setTimeout(() => {
          setIsDeleting(true);
        }, 3000);
      }
    } else {
      if (displayedText.length > 0) {
        timeout = setTimeout(() => {
          setDisplayedText(displayedText.slice(0, -1));
        }, 20);
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
      setTrails(prev => [...prev.slice(-15), newTrail]);
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
      setTrails(prev => prev.map(t => ({ ...t, opacity: t.opacity * 0.85 })).filter(t => t.opacity > 0.05));
      requestAnimationFrame(animateTrails);
    };
    const animationId = requestAnimationFrame(animateTrails);
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent" />

      <div className="hidden md:block">
        {trails.map(trail => (
          <div
            key={trail.id}
            className="fixed w-6 h-6 rounded-full pointer-events-none z-50"
            style={{
              left: trail.x - 12,
              top: trail.y - 12,
              background: `radial-gradient(circle, rgba(59, 130, 246, ${trail.opacity * 0.6}) 0%, rgba(147, 51, 234, ${trail.opacity * 0.3}) 50%, transparent 70%)`,
              filter: 'blur(2px)',
            }}
          />
        ))}
      </div>

      <div
        className="fixed w-8 h-8 rounded-full pointer-events-none z-[60] mix-blend-screen hidden md:block"
        style={{
          left: cursorPos.x - 16,
          top: cursorPos.y - 16,
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.9) 0%, rgba(147, 51, 234, 0.6) 50%, transparent 70%)',
          boxShadow: '0 0 20px rgba(59, 130, 246, 0.5), 0 0 40px rgba(147, 51, 234, 0.3)',
          transition: 'transform 0.1s ease-out',
        }}
      />

      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

      <div className="relative z-10 flex flex-col items-center px-6">
        <div className="flex items-center gap-2 mb-6">
          <Sparkles className="w-5 h-5 text-blue-400 animate-pulse" />
          <span className="text-blue-400 text-sm font-medium tracking-widest uppercase">Welcome</span>
          <Sparkles className="w-5 h-5 text-blue-400 animate-pulse" />
        </div>

        <HandwritingTitle text={mainText} />

        <div className="h-20 flex items-center justify-center">
          <p className="text-lg md:text-xl text-slate-400 max-w-2xl text-center leading-relaxed">
            {displayedText}
            <span className="inline-block w-0.5 h-5 bg-blue-400 ml-1 animate-pulse align-middle" />
          </p>
        </div>

        <div
          ref={buttonContainerRef}
          className="h-16 mt-8 flex items-center justify-center w-full max-w-md"
        >
          <button
            ref={buttonRef}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="group relative px-8 py-3 bg-gradient-to-r from-blue-600 to-blue-500 rounded-full font-semibold text-white overflow-hidden select-none will-change-transform pointer-events-none"
            style={{
              transform: 'translate(0px, 0px)',
            }}
            onClick={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
          >
            <span className="relative z-10 transition-all duration-300">{buttonText}</span>
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </button>
        </div>
      </div>

      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
    </div>
  );
}

export default App;
