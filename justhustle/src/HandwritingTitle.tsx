import {
  JUST_HUSTLE_HEIGHT,
  JUST_HUSTLE_PATH,
  JUST_HUSTLE_VIEWBOX,
  JUST_HUSTLE_WIDTH,
} from './justHustlePath';

type HandwritingTitleProps = {
  text: string;
};

export function HandwritingTitle({ text }: HandwritingTitleProps) {
  return (
    <div className="mb-8 flex justify-center">
      <div className="hello-canvas" role="img" aria-label={text}>
        <svg
          viewBox={JUST_HUSTLE_VIEWBOX}
          width={JUST_HUSTLE_WIDTH}
          height={JUST_HUSTLE_HEIGHT}
          className="block shrink-0"
          style={{ height: 'clamp(7rem, 17vw, 11rem)', width: 'auto' }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="pen-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g transform={`translate(0, ${JUST_HUSTLE_HEIGHT}) scale(1, -1)`}>
            {/* Glow layer — draws same path with blur */}
            <path
              d={JUST_HUSTLE_PATH}
              className="hello-glow-path"
              pathLength="1"
            />
            {/* Main stroke-draw path */}
            <path
              d={JUST_HUSTLE_PATH}
              className="hello-text-path"
              pathLength="1"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
