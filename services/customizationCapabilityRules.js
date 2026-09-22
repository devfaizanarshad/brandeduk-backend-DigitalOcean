const RULESET_VERSION = '2026-09-22.1';
const STATUSES = Object.freeze({ AVAILABLE: 'AVAILABLE', POA: 'POA', UNAVAILABLE: 'UNAVAILABLE', HIDDEN: 'HIDDEN' });
const METHODS = Object.freeze({
  embroidery: { label: 'Embroidery', type: 'stitch', globalStatus: STATUSES.AVAILABLE, customerFacing: true },
  dtf: { label: 'DTF Print', type: 'print', globalStatus: STATUSES.AVAILABLE, customerFacing: true },
  screen_print: { label: 'Screen Print', type: 'print', globalStatus: STATUSES.HIDDEN, customerFacing: false },
});

const A = STATUSES.AVAILABLE;
const P = STATUSES.POA;
const U = STATUSES.UNAVAILABLE;
const product = (dtf, screenPrint, embroidery) => ({ dtf, screen_print: screenPrint, embroidery });

const PRODUCT_CAPABILITIES = Object.freeze({
  cotton_tshirt: product(A,A,P), heavy_premium_tshirt: product(A,A,A), polyester_tshirt: product(A,P,P),
  performance_tshirt: product(A,P,P), hi_vis_tshirt: product(A,P,P), long_sleeve_tshirt: product(A,A,A),
  cotton_polo: product(A,A,A), polyester_polo: product(A,P,A), performance_polo: product(A,P,A), long_sleeve_polo: product(A,A,A),
  work_shirt: product(A,P,A), formal_shirt: product(P,U,A), oxford_shirt: product(P,U,A), blouse: product(P,U,A),
  tunic: product(A,P,A), scrub_top: product(A,P,A), scrub_trousers: product(P,U,P), lab_coat: product(A,P,A), beauty_tunic: product(A,P,A),
  crewneck_sweatshirt: product(A,A,A), pullover_hoodie: product(A,A,A), zip_hoodie: product(A,A,A),
  technical_sweatshirt: product(A,P,A), quarter_zip_sweatshirt: product(A,P,A),
  cotton_knitwear: product(P,U,A), wool_knitwear: product(U,U,P), cardigan: product(P,U,A),
  fleece: product(P,U,A), microfleece: product(P,U,A), zip_fleece: product(P,U,A),
  softshell_jacket: product(A,U,A), softshell_bodywarmer: product(A,U,A), padded_jacket: product(P,U,A),
  waterproof_jacket: product(P,U,A), windbreaker: product(A,P,A), technical_jacket: product(P,U,A),
  bomber_jacket: product(A,P,A), parka: product(P,U,A), padded_bodywarmer: product(P,U,A), bodywarmer: product(A,U,A),
  hi_vis_vest: product(A,A,P), hi_vis_waistcoat: product(A,A,P), hi_vis_polo: product(A,P,A),
  hi_vis_sweatshirt: product(A,A,A), hi_vis_hoodie: product(A,A,A), hi_vis_fleece: product(P,U,A),
  hi_vis_softshell: product(A,U,A), hi_vis_jacket: product(P,U,A), hi_vis_bomber: product(P,U,A), hi_vis_trousers: product(P,U,P),
  coverall: product(A,P,A), boiler_suit: product(A,P,A), bib_and_brace: product(A,P,A),
  workwear_trousers: product(P,U,A), cargo_trousers: product(P,U,A), workwear_shorts: product(P,U,A),
  chef_jacket: product(A,P,A), chef_trousers: product(P,U,P), chef_hat: product(P,U,A),
  bib_apron: product(A,A,A), waist_apron: product(A,A,A), tabard: product(A,A,A), hospitality_waistcoat: product(P,U,A),
  rugby_shirt: product(A,A,A), football_shirt: product(A,P,P), basketball_jersey: product(A,P,U), sports_vest: product(A,P,U),
  tracksuit_top: product(A,P,A), tracksuit_trousers: product(P,U,P), leggings: product(P,U,U), sports_shorts: product(P,P,U), running_jacket: product(A,P,P),
  school_jumper: product(A,A,A), school_cardigan: product(P,U,A), school_blazer: product(P,U,A),
  school_polo: product(A,A,A), school_pe_kit: product(A,A,P), leavers_hoodie: product(A,A,A),
  baby_bodysuit: product(A,A,U), kids_tshirt: product(A,A,P), kids_hoodie: product(A,A,A),
  baseball_cap: product(P,U,A), trucker_cap: product(P,U,A), snapback: product(P,U,A), beanie: product(U,U,A),
  bobble_hat: product(U,U,A), bucket_hat: product(P,P,A), visor: product(P,U,A), balaclava: product(U,U,P),
  scarf: product(P,U,A), gloves: product(U,U,P), tie: product(P,U,A),
  backpack: product(A,P,A), drawstring_bag: product(A,A,A), cotton_tote_bag: product(A,A,A), canvas_bag: product(A,A,A),
  laptop_bag: product(P,U,A), messenger_bag: product(P,U,A), sports_holdall: product(A,P,A), kit_bag: product(A,P,A),
  cooler_bag: product(P,U,A), tool_bag: product(P,U,A), umbrella: product(P,A,U), towel: product(P,U,A),
  blanket: product(P,U,A), patch_badge: product(P,U,A), safety_helmet: product(P,U,U), hard_hat: product(P,U,U),
  safety_footwear: product(U,U,P), socks: product(P,U,P),
});

const POSITION_CAPABILITIES = Object.freeze({
  left_chest: product(A,A,A), right_chest: product(A,A,A), centre_chest: product(A,A,A), large_front: product(A,A,P),
  upper_back: product(A,A,A), large_back: product(A,A,P), left_sleeve: product(A,A,A), right_sleeve: product(A,A,A),
  back_neck: product(A,A,A), lower_front: product(A,A,P), lower_back: product(A,A,P), trouser_thigh: product(A,P,A),
  trouser_leg: product(A,P,P), cap_front: product(P,U,A), cap_side: product(P,U,A), cap_back: product(P,U,A),
  bag_front: product(A,A,A), apron_front: product(A,A,A),
});

const FALLBACK_PRIORITY = Object.freeze({
  embroidery: ['dtf', 'screen_print'], screen_print: ['dtf', 'embroidery'], dtf: ['screen_print', 'embroidery'],
});

module.exports = { RULESET_VERSION, STATUSES, METHODS, PRODUCT_CAPABILITIES, POSITION_CAPABILITIES, FALLBACK_PRIORITY };
