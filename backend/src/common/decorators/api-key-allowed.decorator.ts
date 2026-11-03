import { SetMetadata } from '@nestjs/common'

/** Marks a route (or controller) as callable with a BugPilot personal API key. */
export const API_KEY_ALLOWED = 'apiKeyAllowed'
export const ApiKeyAllowed = () => SetMetadata(API_KEY_ALLOWED, true)
