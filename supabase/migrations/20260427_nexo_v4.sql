-- =============================================================
-- NEXO V4 — Deeper taxonomy: extra subtopics per category
-- giving the AI more dimensions to classify views against.
-- Run this AFTER 20260426_nexo_v3.sql
-- =============================================================

do $$
declare
  v_cat_id  uuid;
  v_sub_id  uuid;
  v_q1_id   uuid;
  v_q2_id   uuid;
begin

  -- ================================================================
  -- IMMIGRATION
  -- ================================================================
  v_cat_id := (select id from public.taxonomy_categories where slug = 'immigration' limit 1);
  if v_cat_id is not null then

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'refugee-asylum') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Refugee & Asylum', 'refugee-asylum', 50,
        'Should the UK maintain or expand safe legal routes for refugees and asylum seekers?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should the UK maintain or expand safe legal pathways for refugees?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Even if it increases overall migration numbers, do you think legal safe routes reduce dangerous Channel crossings?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should asylum seekers be allowed to work while their claim is processed?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'citizenship-pathways') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Citizenship Pathways', 'citizenship-pathways', 55,
        'Should it be easier for long-term residents to become British citizens?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should long-term residents who contribute to UK society have a clear, achievable path to citizenship?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Should language and civic knowledge tests be a requirement — or do they create unfair barriers?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Do you think earned citizenship strengthens social cohesion or weakens national identity?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'immigration-targets') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Net Migration Targets', 'immigration-targets', 60,
        'Should the government set and enforce binding net migration targets?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should the UK government set binding annual limits on net migration?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Previous governments set targets and repeatedly missed them — does that make targets counterproductive or just poorly enforced?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should student visas and family reunification count toward migration targets?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

  end if; -- immigration

  -- ================================================================
  -- ECONOMY
  -- ================================================================
  v_cat_id := (select id from public.taxonomy_categories where slug = 'economy' limit 1);
  if v_cat_id is not null then

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'inequality') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Inequality', 'inequality', 50,
        'Is wealth inequality in the UK too high and should government actively reduce it?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Is the current level of wealth inequality in the UK economically harmful?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Should government actively redistribute wealth through taxes and transfers, or let markets determine outcomes?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Does a wealth tax or higher inheritance tax create the right incentives — or does it discourage investment and savings?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'minimum-wage') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Minimum Wage', 'minimum-wage', 55,
        'Should the minimum wage be substantially higher even if it costs some jobs?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should the UK minimum wage be raised to a genuine living wage even if it reduces employment at the margins?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Should minimum wage rates vary by region to reflect local cost of living — or is a single national rate fairer?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'If raising minimum wage causes some businesses to automate or cut hours, is that an acceptable tradeoff?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'industrial-strategy') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Industrial Strategy', 'industrial-strategy', 60,
        'Should government pick winning sectors and back them with targeted investment?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should government actively back specific UK industries with subsidies and investment rather than leaving it to markets?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'History shows governments are bad at picking winners — does that make industrial strategy a waste, or are some sectors too strategically important to leave to markets?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should green energy and defence manufacturing be prioritised regardless of market signals?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

  end if; -- economy

  -- ================================================================
  -- HOUSING
  -- ================================================================
  v_cat_id := (select id from public.taxonomy_categories where slug = 'housing' limit 1);
  if v_cat_id is not null then

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'renters-rights') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Renters'' Rights', 'renters-rights', 50,
        'Should renters have stronger legal protections against eviction and rent hikes?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should renters have stronger legal protection against sudden evictions and large rent increases?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'If stronger tenant protections discourage landlords and reduce rental supply, is that still worth it?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should there be a national register of landlords with mandatory standards — or does that create too much red tape?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'leasehold-reform') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Leasehold Reform', 'leasehold-reform', 55,
        'Should leasehold be abolished in favour of commonhold ownership?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should the leasehold system be fundamentally reformed or abolished in England and Wales?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Are ground rents and service charges charged by freeholders fair — or are they a form of extraction from homeowners?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should leaseholders have the automatic right to extend their lease at a fair price without legal challenge?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

  end if; -- housing

  -- ================================================================
  -- HEALTHCARE
  -- ================================================================
  v_cat_id := (select id from public.taxonomy_categories where slug = 'healthcare' limit 1);
  if v_cat_id is not null then

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'waiting-lists') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Waiting Lists', 'waiting-lists', 50,
        'Should the NHS use private sector capacity to clear the waiting list backlog?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should the NHS contract private hospitals and clinics to help clear the 7m+ patient backlog?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Does using private providers create a two-tier system — or is it pragmatic to use all available capacity?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should the government set legally binding waiting time targets with consequences for NHS trusts that miss them?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'social-care') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Social Care', 'social-care', 55,
        'Should social care be fully integrated with the NHS and free at the point of use?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should adult social care be merged with the NHS into a single publicly-funded system?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Should there be a cap on how much any individual pays for care during their lifetime — say £86,000?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Is it fair for people to have to sell their homes to fund their own care in old age?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

  end if; -- healthcare

  -- ================================================================
  -- CLIMATE
  -- ================================================================
  v_cat_id := (select id from public.taxonomy_categories where slug = 'climate' limit 1);
  if v_cat_id is not null then

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'fossil-fuel-phaseout') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Fossil Fuel Phaseout', 'fossil-fuel-phaseout', 50,
        'Should the UK commit to a hard deadline for ending new North Sea oil and gas licences?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should the UK stop issuing new licences for North Sea oil and gas exploration?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'If the UK stops producing its own oil and gas, we just import more from elsewhere — does that actually help the climate?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should workers in fossil fuel industries be guaranteed equivalent jobs in renewables through a "just transition"?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'consumer-behaviour') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Consumer Behaviour', 'consumer-behaviour', 55,
        'Should government use taxes or bans to push people toward lower-carbon choices?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should government use taxes, subsidies or bans to change consumer behaviour on climate — e.g. meat taxes, frequent flyer levies?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Individual choices contribute only a fraction of emissions compared to industry — is targeting consumers just distraction?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'If green choices are made the cheapest and easiest option, is that acceptable state influence — or paternalistic overreach?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

  end if; -- climate

  -- ================================================================
  -- EDUCATION
  -- ================================================================
  v_cat_id := (select id from public.taxonomy_categories where slug = 'education' limit 1);
  if v_cat_id is not null then

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'private-schools') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Private Schools', 'private-schools', 50,
        'Should private schools lose their charitable status and VAT exemption?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should private schools lose their charitable status and be subject to VAT like other businesses?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Do private schools entrench inequality by providing better outcomes to those who can pay — or do they relieve pressure on the state system?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should there be a quota requiring private schools to offer a minimum percentage of fully-funded places to state school pupils?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'early-years') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Early Years & Childcare', 'early-years', 55,
        'Should the state provide universal free childcare from age one?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should the government provide free, universal childcare from age one — not just the current 15-30 hours?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Is childcare primarily a parental responsibility, or is it a public good that benefits the whole economy?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'If expanding childcare requires significant tax rises, is that an acceptable trade-off for women''s workforce participation?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

  end if; -- education

  -- ================================================================
  -- TECHNOLOGY & AI
  -- ================================================================
  v_cat_id := (select id from public.taxonomy_categories where slug = 'technology' limit 1);
  if v_cat_id is not null then

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'ai-public-services') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'AI in Public Services', 'ai-public-services', 50,
        'Should government deploy AI to make public services more efficient, even if it means fewer human workers?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should government departments actively use AI to make public services faster and cheaper, even where it displaces workers?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'High-stakes decisions in welfare, justice, and healthcare — should AI ever make them, or only assist humans?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should there be a legal right to human review of any AI decision that affects your benefits, sentencing or medical treatment?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'digital-surveillance') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Digital Surveillance', 'digital-surveillance', 55,
        'Should the government have greater powers to monitor online communications to prevent crime?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should law enforcement have the power to access encrypted messages with a warrant to prevent serious crime?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Encryption backdoors can''t be made available only to good actors — does that make them too dangerous to create?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should facial recognition in public spaces be banned except for specific, court-approved operations?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

  end if; -- technology

  -- ================================================================
  -- DEFENCE & FOREIGN AFFAIRS
  -- ================================================================
  v_cat_id := (select id from public.taxonomy_categories where slug = 'defence' limit 1);
  if v_cat_id is not null then

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'ukraine-aid') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Ukraine & Military Aid', 'ukraine-aid', 50,
        'Should the UK continue or increase military aid to Ukraine for as long as it takes?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should the UK continue providing military and financial support to Ukraine for as long as necessary?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'Is there a point at which continued UK military aid risks direct escalation with Russia — and where is that line?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should the UK push Ukraine toward a negotiated settlement, even if that means accepting territorial losses?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

    if not exists (select 1 from public.taxonomy_subtopics where category_id = v_cat_id and slug = 'defence-spending') then
      insert into public.taxonomy_subtopics (category_id, name, slug, sort_order, latent_question_text)
      values (v_cat_id, 'Defence Spending', 'defence-spending', 55,
        'Should the UK raise defence spending to 3% of GDP in response to global threats?')
      returning id into v_sub_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 1, 'Should the UK commit to spending 3% of GDP on defence, even at the cost of domestic programmes?')
      returning id into v_q1_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 2, 'More defence spending means less for the NHS, schools, and benefits — is that trade-off worth it given the current threat environment?')
      returning id into v_q2_id;

      insert into public.taxonomy_questions (subtopic_id, depth_layer, question_text)
      values (v_sub_id, 3, 'Should the UK build greater defence manufacturing capacity at home rather than buying from the US?');

      update public.taxonomy_questions set yes_next_id = v_q2_id, no_next_id = v_q2_id where id = v_q1_id;
    end if;

  end if; -- defence

end $$;
