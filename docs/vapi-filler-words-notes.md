# Vapi Filler Words Notes

This note documents the safest transient-assistant approach we have found for reducing phrases like:

- `hold on a sec`
- `give me a moment`
- `just a sec`
- `one moment`
- `this will just take a sec`

The focus here is Vapi transient assistants created from our webhook payload, not saved dashboard assistants.

## Short Version

For our setup, the safest current approach is:

1. Do **not** send deprecated or rejected filler config keys in the transient assistant payload.
2. Keep the model at deterministic settings for active-flow calls.
3. Give the model hard no-filler instructions near the top of the system prompt.
4. Set tool lifecycle messages to empty strings for `request-start` and `request-response-delayed`.
5. Strip leading filler server-side from any tool-driven spoken text before returning it to Vapi.
6. Verify with a real call transcript, because local flow simulation cannot prove Vapi audio behavior.

## What Broke Before

These payload properties caused transient assistant creation failures in our environment and should stay out of the payload unless Vapi explicitly confirms support for our org/version:

- `messagePlan.fillerInjectionEnabled`
- `model.fillerInjectionPlan`
- `voice.fillerInjectionEnabled`

Symptoms:

- Vapi returns a `couldn't get assistant` style failure.
- The assistant never starts.

## Current Repo Strategy

These are the current repo-side mitigations that are safe for transient assistants:

### 1. Empty tool lifecycle messages

In the transient tool definitions, use:

```json
"messages": [
  {
    "type": "request-start",
    "content": ""
  },
  {
    "type": "request-response-delayed",
    "content": ""
  }
]
```

Why:

- This is the most promising transient-safe way to suppress Vapi’s tool-start speech.
- It targets tool lifecycle speech directly instead of relying only on prompt obedience.

### 2. Deterministic active-flow model settings

For active-flow calls, keep:

```ts
temperature: 0
```

Why:

- Lower randomness reduces the chance of the model improvising filler phrases around tool calls.

### 3. Hard prompt rules

The system prompt should explicitly say:

- never use filler like `hold on a sec`, `give me a moment`, `just a sec`, `one moment`
- before a tool call, say nothing
- if a server response must be spoken exactly, speak it verbatim with no prefix or suffix

Why:

- Even with empty tool lifecycle messages, the model can still generate filler on its own.

### 4. Server-side filler stripping

Before returning any tool-driven spoken message, strip leading filler phrases server-side.

Examples to strip:

- `Okay, give me a moment.`
- `Hold on a sec.`
- `This will just take a sec.`
- `Let me check.`

Why:

- This is the deterministic backstop.
- If the model tries to prepend filler to a server-owned message, we can remove it before it is spoken.

## Files To Check

These are the main code locations related to filler suppression:

- `/Users/andypham/Applications/Begintake/src/app/api/webhooks/vapi/route.ts`
- `/Users/andypham/Applications/Begintake/src/lib/flow-compiler.ts`
- `/Users/andypham/Applications/Begintake/src/__tests__/api/vapi-assistant-config.test.ts`

In particular, look for:

- `stripLeadingFillers(...)`
- tool `messages` with empty `request-start` and `request-response-delayed`
- `temperature: 0` for active-flow calls
- prompt rules containing `ABSOLUTE RULE`

## What Not To Add Back

Unless Vapi gives us a schema-confirmed example that matches our transient assistant payload exactly, do not reintroduce:

```json
{
  "messagePlan": {
    "fillerInjectionEnabled": false
  }
}
```

or

```json
{
  "model": {
    "fillerInjectionPlan": {
      "enabled": false
    }
  }
}
```

or

```json
{
  "voice": {
    "fillerInjectionEnabled": false
  }
}
```

Reason:

- These were tied to assistant instantiation failures in our environment.

## Specific Implementation Checklist

When touching filler-word behavior, follow this exact checklist:

1. Confirm the assistant is still transient and created from the webhook payload.
2. Keep unsupported filler config keys out of the payload.
3. Make sure every function tool has:
   - `request-start` with `""`
   - `request-response-delayed` with `""`
4. Keep active-flow `temperature: 0`.
5. Keep the no-filler rules near the top of the system prompt.
6. Run the focused config tests.
7. Place a real call and inspect the saved transcript.

## Recommended Test Commands

Run:

```bash
npm test -- --run src/__tests__/api/vapi-assistant-config.test.ts
```

Then run broader webhook coverage:

```bash
npm test -- --run src/__tests__/api/vapi-webhook.test.ts src/lib/active-flow-runner.test.ts
```

Then:

```bash
npm run build
```

## How To Verify It Actually Worked

Use a real call. Local simulation is not enough.

Why:

- Local runner tests validate branch logic.
- They do **not** prove what Vapi spoke on the phone.

After a test call, inspect the latest transcript and search for:

- `hold on`
- `just a sec`
- `give me a moment`
- `one moment`
- `this will just take a sec`

If those still appear in the final transcript, the suppression is incomplete.

## If Filler Still Appears

If filler remains after the current setup:

1. Check whether it appears only around tools or also on ordinary turns.
2. If it is only around tools, inspect the current tool `messages` payload first.
3. If it appears on ordinary turns too, assume the model itself is still generating it and tighten prompt language or expand server-side stripping.
4. If the transcript still looks ambiguous, fetch the call artifacts and inspect the structured messages for the exact call to see whether the phrase came from normal assistant text versus tool lifecycle behavior.

## Rollback Guidance

If a future experiment breaks transient assistant creation:

1. Revert the newly added payload keys first.
2. Return to the known-safe baseline:
   - empty `request-start`
   - empty `request-response-delayed`
   - `temperature: 0`
   - prompt no-filler rules
   - server-side `stripLeadingFillers(...)`
3. Retest with one real call before changing anything else.

## Bottom Line

For our current Begintake transient-assistant setup, the most practical strategy is:

- do not use unsupported filler config flags
- suppress tool lifecycle speech with empty tool messages
- keep the model deterministic
- forbid filler in the prompt
- strip filler server-side as a final safeguard

That combination is the safest path we have found without breaking assistant creation.
