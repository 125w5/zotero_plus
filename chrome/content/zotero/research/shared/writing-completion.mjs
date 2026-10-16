/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {assertAIAction} from './research-ai-policy.mjs';
// Kept only as a compatibility boundary for old windows and stored actions.
export function completionProposal(){assertAIAction('manuscript_continue');}
