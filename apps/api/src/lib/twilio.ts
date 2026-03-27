import Twilio from 'twilio';
import { config } from '../config.js';

export const twilioClient = Twilio(config.twilio.accountSid, config.twilio.authToken);

/** TwiML builders live on the default export (`Twilio.twiml`), not as a named ESM export. */
export const TwiML = Twilio.twiml;
