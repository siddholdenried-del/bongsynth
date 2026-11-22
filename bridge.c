/* SPDX-License-Identifier: GPL-3.0-only */
/* BongSynth: GhettoMachine's instrument-track synth (dsp/synth.c, unchanged) on one track, for the browser.
 * The firmware's own path, cut down to one instrument track:
 *   keys / sequencer -> syn_note_on_f -> syn_prepare, syn_half(0), syn_half(1) -> track insert (COLOR)
 *   -> syn_mix (level, pan, reverb and delay sends) -> fxbus (ROOM reverb, tempo delay) -> out
 * Everything runs in blocks of SYN_CTL (32) samples at 44.1 kHz, as on the FM-1. */
#include <stdint.h>
#include <stddef.h>
#include "synth.h"
#include "color.h"
#include "preset_color.h"
#define X0X_DRUM_TABLES_DEFINE
#include "x0x_drum_tables.h"
#include "fxbus.h"

#define TRK 1
#define OUT_MAX 256
#define STEPS 16
#define FS 44100.0f

static float out_l[OUT_MAX], out_r[OUT_MAX];
static float bl[SYN_CTL], br[SYN_CTL], brv[SYN_CTL], bdl[SYN_CTL], fl[SYN_CTL], fr[SYN_CTL];
static int16_t dline[44100];
static fxbus_t bus;
static int8_t snd[SP_NUM];
static int mono = 1, level = 100, pan = 64, rsend = 20, dsend = 12;
static color_params_t col;
static color_state_t col_rt;
static char text[32];
static float peak;

/* the sequencer: 16 steps, each a note and flags (1 on, 2 accent, 4 slide) */
static uint8_t st_note[STEPS], st_flag[STEPS];
static int playing, cur = -1, transpose, held_slide;
static float bpm = 120.0f, to_next;

/* LFO 1, the track's (the firmware's LFO page, simplified): shape, rate 0..127, depth -64..63, destination SM_* */
static int lfo_shape, lfo_rate = 40, lfo_depth, lfo_dest;
static float lfo_ph, lfo_sh = 0.0f;
static uint32_t rnd = 22222u;

static int insert(int trk, float *l, float *r, unsigned n)
{
    (void)trk;
    color_run(&col_rt, &col, l, r, n);
    return 0;
}
static void route(void) { syn_set_insert(TRK, color_active(&col) ? insert : 0); }
static void mixer(void) { syn_mixer(TRK, pan, (float)rsend / 127.0f, (float)dsend / 127.0f); }

void gs_init(void)
{
    int i;
    syn_init();
    fxbus_init(&bus, dline, (int)(sizeof dline / sizeof dline[0]));
    fxbus_set_bpm(&bus, bpm);
    color_defaults(&col);
    color_reset(&col_rt);
    for (i = 0; i < STEPS; i++) {
        st_note[i] = 36;
        st_flag[i] = 0;
    }
    mono = syn_preset(0, snd);
    syn_sound(TRK, snd);
    syn_level(TRK, (float)(level * level) / 16129.0f);
    mixer();
    route();
}

/* ---- the sound ---- */
int gs_param_count(void) { return SP_NUM; }
const char *gs_param_name(int id) { const syn_param_t *p = syn_param(id); return p ? p->name : NULL; }
int gs_param_min(int id) { const syn_param_t *p = syn_param(id); return p ? p->min : 0; }
int gs_param_max(int id) { const syn_param_t *p = syn_param(id); return p ? p->max : 0; }
int gs_param_def(int id) { const syn_param_t *p = syn_param(id); return p ? p->def : 0; }
int gs_param_fmt(int id) { const syn_param_t *p = syn_param(id); return p ? p->fmt : 0; }
const char *gs_param_text(int id, int v)
{
    int i;
    for (i = 0; i < 32; i++)
        text[i] = 0;
    syn_param_text(id, v, text);
    return text;
}
int gs_get(int id) { return id >= 0 && id < SP_NUM ? snd[id] : 0; }
int gs_set(int id, int v)
{
    const syn_param_t *p = syn_param(id);
    if (!p || v < p->min || v > p->max)
        return 0;
    snd[id] = (int8_t)v;
    syn_set(TRK, id, v);
    return 1;
}
int gs_presets(void) { return syn_presets(); }
const char *gs_preset_name(int i) { return i >= 0 && i < syn_presets() ? syn_preset_name(i) : NULL; }
int gs_preset_color(int i) { return syn_preset_color(i); }
/* a factory sound, as the firmware loads one: its parameters, MONO or POLY, and its COLOR recipe */
int gs_preset(int i)
{
    if (i < 0 || i >= syn_presets())
        return -1;
    syn_release(TRK, 0);
    mono = syn_preset(i, snd);
    syn_sound(TRK, snd);
    if (preset_color_apply(&col, syn_preset_color(i))) {
        color_reset(&col_rt);
        route();
    }
    return mono;
}
void gs_mono(int m) { if (m != mono) { syn_release(TRK, 0); mono = m ? 1 : 0; } }
int gs_is_mono(void) { return mono; }

/* COLOR, the track's post-send texture: 0 AMOUNT, 1 WEAR, 2 WOW, 3 DIGITAL, 4 DROP (0..127), 5 ON (0/1) */
void gs_color(int k, int v)
{
    if (k < 0 || k >= COL_NUM || v < 0 || v > (k == COL_ON ? 1 : 127))
        return;
    col.v[k] = (uint8_t)v;
    route();
}
int gs_color_get(int k) { return k >= 0 && k < COL_NUM ? col.v[k] : 0; }

/* ---- the mix and the send effects ---- */
void gs_level(int v) { if (v >= 0 && v <= 127) { level = v; syn_level(TRK, (float)(v * v) / 16129.0f); } }
void gs_pan(int v) { if (v >= 0 && v <= 127) { pan = v; mixer(); } }
void gs_send(int which, int v) { if (v >= 0 && v <= 127) { if (which) dsend = v; else rsend = v; mixer(); } }
int gs_fx_count(void) { return fxbus_nparams(); }
const char *gs_fx_name(int i) { const x0x_param_t *p = fxbus_param(i); return p ? p->name : NULL; }
int gs_fx_max(int i) { const x0x_param_t *p = fxbus_param(i); return p ? p->max : 0; }
int gs_fx_def(int i) { const x0x_param_t *p = fxbus_param(i); return p ? p->def : 0; }
const char *gs_fx_option(int i, int v)
{
    const x0x_param_t *p = fxbus_param(i);
    return p && p->names && v >= 0 && v <= p->max ? p->names[v] : NULL;
}
void gs_fx(int i, int v) { if (i >= 0 && i < fxbus_nparams() && v >= 0 && v <= fxbus_param(i)->max) fxbus_set(&bus, i, v); }
int gs_fx_get(int i) { return fxbus_get(&bus, i); }

/* ---- playing it ---- */
void gs_note_on(int note, int vel) { if (note >= 0 && note < 128) syn_note_on(TRK, note, (float)vel / 127.0f, -1, mono); }
void gs_note_off(int note) { if (note >= 0 && note < 128) syn_note_off(TRK, note); }
void gs_panic(void) { syn_release(TRK, 0); }

void gs_tempo(int bpm10) { if (bpm10 >= 400 && bpm10 <= 2400) { bpm = (float)bpm10 * 0.1f; fxbus_set_bpm(&bus, bpm); } }
void gs_step_set(int i, int note, int flags)
{
    if (i < 0 || i >= STEPS || note < 0 || note > 127)
        return;
    st_note[i] = (uint8_t)note;
    st_flag[i] = (uint8_t)(flags & 7);
}
void gs_transpose(int t) { if (t >= -24 && t <= 24) transpose = t; }
void gs_play(int on)
{
    playing = on ? 1 : 0;
    cur = -1;
    to_next = 0.0f;
    held_slide = 0;
    if (!playing)
        syn_release(TRK, 1);
}
int gs_step(void) { return playing ? cur : -1; }

void gs_lfo(int shape, int rate, int depth, int dest)
{
    if (shape >= 0 && shape <= 4) lfo_shape = shape;
    if (rate >= 0 && rate <= 127) lfo_rate = rate;
    if (depth >= -64 && depth <= 63) lfo_depth = depth;
    if (dest >= 0 && dest < SM_NUM) lfo_dest = dest;
}
static float lfo_hz(int r) { return 0.05f * __builtin_powf(400.0f, (float)r / 127.0f); }   /* 0.05 .. 20 Hz */

static void seq_tick(void)
{
    const float step = FS * 60.0f / bpm * 0.25f;
    if (!playing)
        return;
    to_next -= (float)SYN_CTL;
    if (to_next > 0.0f)
        return;
    to_next += step;
    cur = (cur + 1) % STEPS;
    if (st_flag[cur] & 1) {
        int f = (st_flag[cur] & 2 ? SN_ACCENT : 0) | (held_slide ? SN_SLIDE : 0);
        int n = st_note[cur] + transpose;
        int32_t gate = st_flag[cur] & 4 ? (int32_t)(step + 2 * SYN_CTL) : (int32_t)(step * 0.55f);
        if (n < 0) n = 0;
        if (n > 127) n = 127;
        syn_note_on_f(TRK, n, st_flag[cur] & 2 ? 1.0f : 0.78f, gate, mono, f);
        held_slide = (st_flag[cur] & 4) != 0;
    } else {
        held_slide = 0;
    }
}

static float lfo_tick(void)
{
    float p, v;
    lfo_ph += lfo_hz(lfo_rate) * (float)SYN_CTL / FS;
    if (lfo_ph >= 1.0f) {
        lfo_ph -= 1.0f;
        rnd = rnd * 1664525u + 1013904223u;
        lfo_sh = (float)(rnd >> 8) / 8388608.0f - 1.0f;
    }
    p = lfo_ph;
    switch (lfo_shape) {
    case 0: v = __builtin_sinf(6.2831853f * p); break;                  /* SINE */
    case 1: v = p < 0.5f ? 4.0f * p - 1.0f : 3.0f - 4.0f * p; break;   /* TRI */
    case 2: v = 1.0f - 2.0f * p; break;                                /* SAW (down) */
    case 3: v = p < 0.5f ? 1.0f : -1.0f; break;                        /* SQUARE */
    default: v = lfo_sh; break;                                       /* S&H */
    }
    return v;
}

void gs_render(int n)
{
    int at, i;
    if (n <= 0 || n > OUT_MAX)
        return;
    for (at = 0; at < n; at += SYN_CTL) {
        seq_tick();
        syn_mod(TRK, lfo_dest, lfo_tick(), (float)lfo_depth / 64.0f);
        syn_prepare();
        syn_half(0);
        syn_half(1);
        syn_mix(bl, br, brv, bdl);
        fxbus_process_st(&bus, bl, br, brv, bdl, fl, fr, SYN_CTL);
        for (i = 0; i < SYN_CTL && at + i < n; i++) {
            float a = fl[i], b = fr[i];
            float m = (a < 0 ? -a : a) > (b < 0 ? -b : b) ? (a < 0 ? -a : a) : (b < 0 ? -b : b);
            if (m > peak) peak = m;
            out_l[at + i] = a;
            out_r[at + i] = b;
        }
    }
}
float *gs_left(void) { return out_l; }
float *gs_right(void) { return out_r; }
float gs_peak(void) { float p = peak; peak = 0.0f; return p; }
int gs_voices(void) { return syn_voices(TRK); }
