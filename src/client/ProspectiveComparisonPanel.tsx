import type {
  ProspectivePick,
  ProspectiveRule,
  ProspectiveView,
} from "../shared/prospective.js";
import { date, earningsDifference, earningsMoney } from "./format.js";
import "./prospective.css";

const names: Record<ProspectiveRule, string> = {
  persistence: "Standard stress",
  returning: "Returning competition",
  highestFees: "Highest eligible fees",
  highestRewards: "Highest pool rewards",
  highestApr: "Highest stake APR",
};

type Hold = ProspectiveView["slots"][number];

function poolLabel(pick: ProspectivePick) {
  return (
    pick.label ??
    (pick.forecastId ? "unavailable saved pool" : "no eligible pool")
  );
}

function savedPair(picks: NonNullable<Hold["picks"]>) {
  const { persistence: standard, returning } = picks;
  if (standard.poolId && standard.poolId === returning.poolId)
    return (
      <>
        Both rankings chose <strong>{standard.label}</strong>.
      </>
    );
  return (
    <>
      Standard stress chose <strong>{poolLabel(standard)}</strong>. Returning
      competition chose <strong>{poolLabel(returning)}</strong>.
    </>
  );
}

function SlotDetails({ hold }: { hold: Hold }) {
  const picks = hold.picks;
  const statuses = {
    open: "Open for collection",
    missed: "Missed",
    holding: "Holding",
    settling: "Awaiting closing observations",
    mature: "Closed",
  };
  return (
    <li>
      <details>
        <summary>
          Hold {hold.slot + 1} · {date(hold.scheduledAt)} ·{" "}
          {statuses[hold.status]}
        </summary>
        {picks ? (
          <>
            {hold.at !== null && <p>Picks saved {date(hold.at)}.</p>}
            <dl className="prospective-picks">
              {(Object.keys(names) as ProspectiveRule[]).map((rule) => {
                const pick = picks[rule];
                return (
                  <div key={rule}>
                    <dt>{names[rule]}</dt>
                    <dd>
                      <span title={pick.poolId ?? undefined}>
                        {poolLabel(pick)}
                      </span>
                      {hold.status === "mature" && (
                        <small>
                          {pick.observedReturnProxy === null
                            ? (pick.reason ?? "Outcome unavailable")
                            : earningsMoney(pick.observedReturnProxy)}
                        </small>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </>
        ) : (
          <p>
            {hold.status === "open"
              ? "Waiting for a collection with eligible timing."
              : "The collection window closed without a saved decision."}
          </p>
        )}
      </details>
    </li>
  );
}

export function ProspectiveComparisonPanel({
  view,
}: {
  view: ProspectiveView;
}) {
  const pair = view.comparisons.find(
    (row) => row.left === "returning" && row.right === "persistence",
  );
  const latest = view.slots.at(-1);
  const distinct = pair ? pair.matched - pair.samePool : 0;
  const benchmarks = view.comparisons.filter(
    (row) => row.right !== "persistence",
  );
  return (
    <section className="panel prospective" aria-labelledby="prospective-title">
      <div className="panel-header">
        <div>
          <h2 id="prospective-title">
            Standard stress vs. returning competition
          </h2>
          <p>
            Every 48 hours, Gaugecraft saves the top pool from each ranking.
            Returning competition tests what happens if voting power comes back
            to its recent median. Each result estimates earnings for 1,000
            additional voting power.
          </p>
        </div>
      </div>
      <div className="prospective-progress">
        <strong>
          {view.recorded} of {view.totalSlots} holds recorded
        </strong>
        <span>
          {view.comparable} with both results · {view.missed} missed
        </span>
      </div>
      <div className="prospective-body">
        {latest?.picks && (
          <p>
            <strong>Hold {latest.slot + 1}.</strong> {savedPair(latest.picks)}
            {latest.status === "holding" && latest.dueAt !== null && (
              <> The 48-hour hold ends {date(latest.dueAt)}.</>
            )}
            {latest.status === "settling" && (
              <> Waiting for closing observations.</>
            )}
          </p>
        )}
        {latest?.status === "open" && (
          <p>
            Hold {latest.slot + 1} is open for collection until{" "}
            {date(latest.scheduledAt + view.graceSeconds)}.
          </p>
        )}
        {latest?.status === "missed" && (
          <p>Hold {latest.slot + 1} closed without a saved decision.</p>
        )}
        {view.nextAt !== null && (
          <p>
            {latest ? "Next" : "First"} decision window opens{" "}
            {date(view.nextAt)}.
          </p>
        )}
        {pair && pair.matched > 0 && (
          <p>
            The rankings picked the same pool in {pair.samePool} of{" "}
            {pair.matched} scored holds.
            {distinct > 0 && (
              <>
                {" "}
                When picks differed, returning competition won {
                  pair.wins
                } of {distinct}
                {pair.ties > 0 ? ` with ${pair.ties} tied` : ""}. Its median
                difference was{" "}
                <strong>{earningsDifference(pair.medianDifference)}</strong> and
                its lowest difference was{" "}
                <strong>{earningsDifference(pair.worstDifference)}</strong>.
              </>
            )}
          </p>
        )}
        {view.mature > 0 && pair && view.mature > pair.matched && (
          <p>
            {view.mature - pair.matched} closed{" "}
            {view.mature - pair.matched === 1 ? "hold lacks" : "holds lack"} a
            complete pair of outcomes. See the hold record for each reason.
          </p>
        )}
      </div>
      {view.mature > 0 && benchmarks.length > 0 && (
        <details className="prospective-detail">
          <summary>Compare both rankings with fees, rewards and APR</summary>
          <p>
            Each row uses holds with earnings measured for both choices. Wins
            and dollar differences use only holds where the two pools differed.
          </p>
          <div className="prospective-comparisons">
            {benchmarks.map((row) => (
              <article key={row.left + row.right}>
                <h3>
                  {names[row.left]} vs. {names[row.right]}
                </h3>
                <p>
                  {row.matched} scored · {row.samePool} same pool ·{" "}
                  {row.missing} missing
                </p>
                {row.matched > row.samePool && (
                  <p>
                    Wins {row.wins} · Ties {row.ties} · Losses {row.losses}
                    <br />
                    Median {earningsDifference(row.medianDifference)} · Lowest{" "}
                    {earningsDifference(row.worstDifference)}
                  </p>
                )}
              </article>
            ))}
          </div>
        </details>
      )}
      {view.slots.length > 0 && (
        <details className="prospective-detail">
          <summary>Hold record and saved picks</summary>
          <ul className="prospective-holds">
            {[...view.slots].reverse().map((hold) => (
              <SlotDetails key={hold.slot} hold={hold} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
