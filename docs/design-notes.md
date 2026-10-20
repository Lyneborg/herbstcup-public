# Design notes

## Identity and source authority

A participant ID identifies a registration in one source plan, not a person or a universal club identity. Scope IDs by source URL. Identical team names are insufficient to link phases. Only published assignments with unambiguous predecessor references and consistent official standings can establish a link. Pending or corrected standings must revoke unsupported links.

## Phases and carried results

A later phase can be published before the current phase ends. Publication time alone is not a phase transition. Keep the current phase visible until its required real matches have finished, and show the next phase as upcoming. A carried result belongs in the official later table but is not an additional played match when summarizing the team's event.

## Failure and transport

Keep availability, stale upstream data and latency separate. A source failure does not by itself mean the app is down. JSON compression must preserve exactly the same data, including stale flags and corrections. Serialize once before asynchronous compression and respect explicit content-encoding exclusions.

## End of an event

Verify final results against official sources, retain a private backup, and replace active imports with a clearly dated archive. Preserve the old runtime and data for rollback. Shared infrastructure may host unrelated applications; retiring one app does not justify stopping the shared server.

These notes explain design choices and limits. They are not instructions to modify official tournament data.
