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
      <div
        className="hello-canvas"
        style={{ ['--hello-width' as string]: `${JUST_HUSTLE_WIDTH}px` }}
        role="img"
        aria-label={text}
      >
        <svg
          viewBox={JUST_HUSTLE_VIEWBOX}
          width={JUST_HUSTLE_WIDTH}
          height={JUST_HUSTLE_HEIGHT}
          className="hello-svg block shrink-0"
          style={{ height: 'clamp(5.5rem, 14vw, 7.5rem)', width: 'auto' }}
          preserveAspectRatio="xMinYMid meet"
        >
          <g transform={`translate(0, ${JUST_HUSTLE_HEIGHT}) scale(1, -1)`}>
            <path d={JUST_HUSTLE_PATH} className="hello-text-path" />
          </g>
        </svg>
      </div>
    </div>
  );
}
