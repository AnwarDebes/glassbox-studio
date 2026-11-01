import { useSession } from '../state/session';
import { compact, factor } from './format';

/**
 * Tokens spent by the LLM next to the logic operations spent by the Tsetlin
 * models, and how much cheaper those decisions were than asking an LLM judge.
 */
export function ComputeMeter() {
  const c = useSession((s) => s.compute);
  const tokens = c.llmPrompt + c.llmCompletion;
  const savingsFactor = c.tmOps > 0 ? c.judgeOps / c.tmOps : 0;
  const title =
    'The LLM figure counts prompt and reply tokens' +
    (c.llmEstimated ? ' (estimated where the provider did not report them)' : '') +
    '. The logic figure counts the operations the Tsetlin models used for routing and guard decisions. ' +
    'The factor compares them with an LLM judge making the same decisions. Both are estimates.';
  return (
    <div className="meter" title={title} role="group" aria-label="Compute used in this session">
      <div className="meter-cell llm">
        <span className="meter-label">LLM</span>
        <span className="meter-value">
          {compact(tokens)} <span className="meter-unit">tokens{c.llmEstimated ? ' (est.)' : ''}</span>
        </span>
      </div>
      <div className="meter-cell logic">
        <span className="meter-label">Logic</span>
        <span className="meter-value">
          {compact(c.tmOps)} <span className="meter-unit">ops for {c.tmDecisions} decision{c.tmDecisions === 1 ? '' : 's'}</span>
        </span>
      </div>
      <div className="meter-cell savings">
        {c.tmDecisions ? (
          <>
            <span className="meter-value">{factor(savingsFactor)}</span>
            <span className="meter-unit">less compute than an LLM judge, est.</span>
          </>
        ) : (
          <span className="meter-unit">Decisions will show their compute here.</span>
        )}
      </div>
    </div>
  );
}
