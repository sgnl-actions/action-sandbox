/**
 * @license MIT
 * Copyright (c) 2025 SGNL.ai, Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
"use strict";var e={invoke:async(e,o)=>{console.log("Starting job execution"),console.log(`Processing target: ${e.target}`),console.log(`Action: ${e.action}`);const{target:t,action:n,options:s=[],dry_run:r=!1}=e;r&&console.log("DRY RUN: No changes will be made");const l=o.env.ENVIRONMENT||"development";return console.log(`Running in ${l} environment`),o.secrets.API_KEY&&console.log(`Using API key ending in ...${o.secrets.API_KEY.slice(-4)}`),o.outputs&&Object.keys(o.outputs).length>0&&(console.log(`Available outputs from ${Object.keys(o.outputs).length} previous jobs`),console.log(`Previous job outputs: ${Object.keys(o.outputs).join(", ")}`)),console.log(`Performing ${n} on ${t}...`),s.length>0&&console.log(`Processing ${s.length} options: ${s.join(", ")}`),console.log(`Successfully completed ${n} on ${t}`),{status:r?"dry_run_completed":"success",target:t,processed_at:(new Date).toISOString()}},error:async(e,o)=>{const{error:t,target:n}=e;throw console.error(`Job encountered error while processing ${n}: ${t.message}`),new Error(`Unable to recover from error: ${t.message}`)},halt:async(e,o)=>{const{reason:t,target:n}=e;return console.log(`Job is being halted (${t}) while processing ${n}`),{status:"halted",target:n||"unknown",reason:t,halted_at:(new Date).toISOString()}}};module.exports=e;
