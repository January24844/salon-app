-- =====================================================================
--  IMPORT PRODUKTÓW Z VERSUM (94 pozycji) – ceny i stany magazynowe.
--  Uruchom PO 013_magazyn.sql. Można uruchomić ponownie – istniejące
--  produkty (ta sama nazwa) zostaną pominięte.
-- =====================================================================
begin;

insert into product_categories (name, sort_order) values ('Epicuren', 1)
on conflict (name) do nothing;

create temp table _imp(name text, category text, kind text, sku text, capacity numeric, stock numeric, price numeric) on commit drop;
insert into _imp values
  ('Acidophilius Probiotic Facial Cream 74ml', 'Epicuren', 'towar', null, null, 0.00, 236.00),
  ('After Bath Unscented moisturizer', 'Epicuren', 'towar', null, null, 0.00, 191.00),
  ('aloe vera calming gel 236ml', 'Epicuren', 'towar', null, null, 0.00, 198.00),
  ('Anti-Aging Lip Balm SPF 15 (słoiczek lub sztyft)', 'Epicuren', 'towar', null, null, 5.00, 60.00),
  ('Apricot Facial Scrub 74ml', 'Epicuren', 'towar', null, 74.00, 1.00, 145.00),
  ('Brazilian Propolis Lotion 60ml', 'Epicuren', 'towar', null, null, 3.00, 180.00),
  ('Citrus Herbal Cleanser 60ml', 'Epicuren', 'towar', null, null, 0.00, 136.00),
  ('Clarify Blemish Eraser 30ml', 'Epicuren', 'towar', null, null, 1.00, 135.00),
  ('Clarify cleanser 60', 'Epicuren', 'towar', null, null, 0.00, 127.00),
  ('Clarify Polishing mask', 'Epicuren', 'towar', null, null, 1.00, 145.00),
  ('Colostrum duo', 'Epicuren', 'towar', null, null, 1.00, 580.00),
  ('Colostrum Luminous Glow Cream 118ml', 'Epicuren', 'towar', null, null, 0.00, 672.00),
  ('epicuren zestaw pro collagen, instantlift i eye serum', 'Epicuren', 'towar', null, null, 0.00, 545.00),
  ('epicuren zestaw Ultima Peptide, instantlift i eye serum', 'Epicuren', 'towar', null, null, 0.00, 900.00),
  ('Facial Emulsion Enzyme Moisturizer 118', 'Epicuren', 'towar', null, 60.00, 1.00, 270.00),
  ('Facial Emulsion Enzyme Moisturizer 60', 'Epicuren', 'towar', null, null, 0.00, 150.00),
  ('Gel Plus Enzyme Protein Gel 60ml', 'Epicuren', 'towar', null, 60.00, 1.00, 365.00),
  ('green tea & seaweed soothing mask', 'Epicuren', 'towar', null, null, 1.00, 215.00),
  ('Herbal cleanser 60ml', 'Epicuren', 'towar', null, null, 1.00, 155.00),
  ('Hydrating Mineral mask 74ml', 'Epicuren', 'towar', null, null, 1.00, 108.00),
  ('Instantlift Tightening Serum 30ml', 'Epicuren', 'towar', null, null, 1.00, 280.00),
  ('kukui coconut after bath moistuizer 60', 'Epicuren', 'towar', null, null, 0.00, 69.00),
  ('kukui nut coconut massage & body oil', 'Epicuren', 'towar', null, null, 0.00, 198.00),
  ('Microderm ultra refining scrub', 'Epicuren', 'towar', null, null, 0.00, 325.00),
  ('Mint and Rosmary Duo (dwa kremy do ciała)', 'Epicuren', 'towar', null, null, 4.00, 145.00),
  ('Mint Renewal White Sand Body Polish 190g', 'Epicuren', 'towar', null, null, 1.00, 200.00),
  ('Papaya Pineapple Bamboo Body Polish 190g', 'Epicuren', 'towar', null, null, 0.00, 200.00),
  ('Pro Collagen+ serum Amplifier 30ml', 'Epicuren', 'towar', null, null, 0.00, 388.00),
  ('Protein Mist Enzyme Toner 60ml', 'Epicuren', 'towar', null, null, 1.00, 100.00),
  ('pumpkin apple spice peel 74ml', 'Epicuren', 'towar', null, null, 0.00, 240.00),
  ('QD Quench Duo Kit (serum kolagenowe i zel kwas hialuronowy)', 'Epicuren', 'towar', null, null, 1.00, 455.00),
  ('Refresh Aloe Cucumber mist 118ml', 'Epicuren', 'towar', null, 125.00, 1.00, 160.00),
  ('Scrub epicuren', 'Epicuren', 'towar_material', null, null, 0.00, 184.00),
  ('skin brightening serum 30', 'Epicuren', 'towar', null, null, 1.00, 740.00),
  ('tighten up neck firming cream 35', 'Epicuren', 'towar', null, null, 1.00, 440.00),
  ('Vanilla After Bath', 'Epicuren', 'towar', null, null, 0.00, 191.00),
  ('anti bump foaming gel lycon', null, 'towar', null, null, 0.00, 75.00),
  ('Aromatherapy Breathe oil', null, 'towar', null, null, 1.00, 190.00),
  ('Aromatherapy Emulsion Kashmir Spice', null, 'towar', null, 60.00, 1.00, 76.00),
  ('Aromatherapy Emulsion Tea Tree', null, 'towar', null, 60.00, 1.00, 76.00),
  ('Aromatherapy Sacret Youth oil', null, 'towar', null, null, 0.00, 190.00),
  ('Aromatherapy Tea Tree Mist', null, 'towar', null, null, 0.00, 115.00),
  ('Aromatherpy Body Balm Tea Tree', null, 'towar', null, null, 0.00, 206.00),
  ('Body Complex', null, 'towar', null, null, 0.00, 245.00),
  ('Brazilian Propolis Serum Moisturizer', null, 'towar', null, null, 0.00, 330.00),
  ('Brazilian Propolis Serum Moisturizer 30ml', null, 'towar', null, null, 0.00, 175.00),
  ('Brazilian propolis toner', null, 'towar', null, null, 0.00, 79.00),
  ('Chai Soy Mask', null, 'towar', null, null, 0.00, 49.00),
  ('Cleaning complex mały', null, 'towar', null, null, 0.00, 75.00),
  ('clear glycolic skin peel 10%', null, 'towar', null, 60.00, 1.00, 145.00),
  ('Collagen 360 zestaw', null, 'towar', null, null, 2.00, 250.00),
  ('Cream Cleanser', null, 'towar', null, null, 0.00, 145.00),
  ('Crystal fiber mask saszetka', null, 'towar', null, null, 0.00, 60.00),
  ('emla krem 30g', null, 'towar_material', null, null, 0.00, 147.60),
  ('Enzyme Concentrate Vitamin Protein Complex', null, 'towar', null, null, 0.00, 193.00),
  ('Extra Fine Citrus Facial Scrub', null, 'towar', null, 74.00, 2.00, 76.00),
  ('Flavonoid Extra Cream', null, 'towar', null, null, 1.00, 130.00),
  ('Gel Plus Enzyme Protein Gel', null, 'towar', null, null, 0.00, 450.00),
  ('Guava peeling Lycon', null, 'towar', null, null, 1.00, 118.00),
  ('Himalayan Superfriut Enzyme Polish', null, 'towar', null, 74.00, 1.00, 270.00),
  ('Hydra Vital K', null, 'towar', null, null, 0.00, 270.00),
  ('Hydro Plus Moisturizer 125 ml', null, 'towar', null, null, 0.00, 320.00),
  ('Ilcsi 7 ziół maska', null, 'towar', null, null, 0.00, 100.00),
  ('Ilcsi tonik siarkowy', null, 'towar', null, null, 0.00, 108.00),
  ('Ilcsi Wiśnia i Tarnina', null, 'towar', null, null, 0.00, 120.00),
  ('kosmetyczka aox ferulic serum + collagen 360', null, 'towar', null, null, 0.00, 405.00),
  ('kuracja z vit C mesoestetic 4 amp.', null, 'towar', null, null, 0.00, 205.00),
  ('Lancer Gel', null, 'towar', null, null, 0.00, 104.00),
  ('lifting code serum peptydowe', null, 'towar', null, null, 0.00, 395.00),
  ('Lycon balsam czekoladowy', null, 'towar', null, null, 1.00, 0.00),
  ('Lycon oliwka czekoladowa', null, 'towar', null, null, 0.00, 0.00),
  ('Micro Derm Exfoliation Cream', null, 'towar', null, 15.00, 2.00, 98.00),
  ('Milk Cleanser', null, 'towar', null, null, 0.00, 41.50),
  ('moisturising complex', null, 'towar', null, null, 0.00, 290.00),
  ('Moroccan Rosemary', null, 'towar', null, null, 0.00, 160.00),
  ('orange blossom', null, 'towar', null, null, 0.00, 41.00),
  ('Phyto O2 Hydration Serum', null, 'towar', null, 30.00, 5.00, 342.00),
  ('Phyto Placenta Serum', null, 'towar', null, null, 0.00, 240.00),
  ('pinkini intimate wash', null, 'towar', null, null, 0.00, 57.00),
  ('pommegranate peeling LYCON', null, 'towar', null, null, 0.00, 118.00),
  ('Retinol Anti Wrinkle Complex', null, 'towar', null, null, 0.00, 498.00),
  ('Rosemary Lave 250 ml', null, 'towar', null, 250.00, 1.00, 130.00),
  ('Skin Lightener Balancing Cream', null, 'towar', null, null, 0.00, 72.00),
  ('Soberry lotion Lycon', null, 'towar', null, 250.00, 1.00, 105.00),
  ('Sport Massage Cream', null, 'towar', null, 250.00, 1.00, 86.00),
  ('super serum advance', null, 'towar', null, null, 0.00, 290.00),
  ('tri active exfoliant', null, 'towar', null, null, 0.00, 220.00),
  ('Tropical Lave', null, 'towar', null, null, 0.00, 38.00),
  ('volcanic clay purifying mask', null, 'towar', null, null, 0.00, 49.00),
  ('Youth Complex is Clinical', null, 'towar', null, null, 0.00, 530.00),
  ('Youth eye complex', null, 'towar', null, null, 0.00, 390.00),
  ('Zestaw epicuren', null, 'towar', null, null, 0.00, 685.00),
  ('zestaw epicuren woreczek', null, 'towar', null, null, 0.00, 190.00),
  ('zinc oxide spf 27', null, 'towar', null, 74.00, 1.00, 175.00);

with nowe as (
  insert into products (name, category_id, kind, sku, capacity_ml, price)
  select i.name, (select id from product_categories c where c.name = i.category), i.kind, i.sku, i.capacity, i.price
  from _imp i
  where not exists (select 1 from products p where lower(p.name) = lower(i.name))
  returning id, name
)
-- stan początkowy jako ruch magazynowy (widoczny w historii)
insert into stock_movements (product_id, change, reason, note)
select n.id, i.stock, 'korekta', 'Stan początkowy z Versum'
from nowe n join _imp i on i.name = n.name
where i.stock <> 0;

commit;

select count(*) as produktow, count(*) filter (where stock > 0) as na_stanie from products;

