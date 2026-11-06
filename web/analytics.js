/**
 * Vercel Web Analytics integration
 * This file initializes Vercel Analytics for tracking page views and user interactions.
 * 
 * The script will automatically load from Vercel's CDN when deployed to Vercel.
 * After enabling Web Analytics in the Vercel dashboard, a script at /_vercel/insights/script.js
 * is automatically served and will process the queued events.
 */

// Initialize the analytics queue
// This sets up window.va to queue events until the actual analytics script loads
window.va = window.va || function () { 
  (window.vaq = window.vaq || []).push(arguments); 
};
