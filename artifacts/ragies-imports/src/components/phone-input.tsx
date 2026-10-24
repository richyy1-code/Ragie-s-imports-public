import { useEffect, useState } from 'react';

type Country = { iso: string; name: string; code: string };

// ISO country/territory calling codes. Shared calling plans remain separately selectable.
const countries: Country[] = [
  ['AF','Afghanistan','93'],['AL','Albania','355'],['DZ','Algeria','213'],['AS','American Samoa','1684'],['AD','Andorra','376'],['AO','Angola','244'],['AI','Anguilla','1264'],['AG','Antigua and Barbuda','1268'],['AR','Argentina','54'],['AM','Armenia','374'],['AW','Aruba','297'],['AU','Australia','61'],['AT','Austria','43'],['AZ','Azerbaijan','994'],['AX','Åland Islands','358'],
  ['BS','Bahamas','1242'],['BH','Bahrain','973'],['BD','Bangladesh','880'],['BB','Barbados','1246'],['BY','Belarus','375'],['BE','Belgium','32'],['BZ','Belize','501'],['BJ','Benin','229'],['BM','Bermuda','1441'],['BT','Bhutan','975'],['BO','Bolivia','591'],['BA','Bosnia and Herzegovina','387'],['BW','Botswana','267'],['BR','Brazil','55'],['IO','British Indian Ocean Territory','246'],['VG','British Virgin Islands','1284'],['BN','Brunei','673'],['BG','Bulgaria','359'],['BF','Burkina Faso','226'],['BI','Burundi','257'],['BQ','Caribbean Netherlands','599'],
  ['KH','Cambodia','855'],['CM','Cameroon','237'],['CA','Canada','1'],['CV','Cape Verde','238'],['KY','Cayman Islands','1345'],['CF','Central African Republic','236'],['TD','Chad','235'],['CL','Chile','56'],['CN','China','86'],['CX','Christmas Island','61'],['CC','Cocos Islands','61'],['CO','Colombia','57'],['KM','Comoros','269'],['CG','Congo','242'],['CD','Congo (DRC)','243'],['CK','Cook Islands','682'],['CR','Costa Rica','506'],['CI','Côte d’Ivoire','225'],['HR','Croatia','385'],['CU','Cuba','53'],['CW','Curaçao','599'],['CY','Cyprus','357'],['CZ','Czechia','420'],
  ['DK','Denmark','45'],['DJ','Djibouti','253'],['DM','Dominica','1767'],['DO','Dominican Republic','1809'],['EC','Ecuador','593'],['EG','Egypt','20'],['SV','El Salvador','503'],['GQ','Equatorial Guinea','240'],['ER','Eritrea','291'],['EE','Estonia','372'],['SZ','Eswatini','268'],['ET','Ethiopia','251'],
  ['AC','Ascension Island','247'],['FK','Falkland Islands','500'],['FO','Faroe Islands','298'],['FJ','Fiji','679'],['FI','Finland','358'],['FR','France','33'],['GF','French Guiana','594'],['PF','French Polynesia','689'],['GA','Gabon','241'],['GM','Gambia','220'],['GE','Georgia','995'],['DE','Germany','49'],['GH','Ghana','233'],['GI','Gibraltar','350'],['GR','Greece','30'],['GL','Greenland','299'],['GD','Grenada','1473'],['GP','Guadeloupe','590'],['GU','Guam','1671'],['GT','Guatemala','502'],['GG','Guernsey','44'],['GN','Guinea','224'],['GW','Guinea-Bissau','245'],['GY','Guyana','592'],
  ['HT','Haiti','509'],['HN','Honduras','504'],['HK','Hong Kong','852'],['HU','Hungary','36'],['IS','Iceland','354'],['IN','India','91'],['ID','Indonesia','62'],['IR','Iran','98'],['IQ','Iraq','964'],['IE','Ireland','353'],['IM','Isle of Man','44'],['IL','Israel','972'],['IT','Italy','39'],
  ['JM','Jamaica','1876'],['JP','Japan','81'],['JE','Jersey','44'],['JO','Jordan','962'],['KZ','Kazakhstan','7'],['KE','Kenya','254'],['KI','Kiribati','686'],['XK','Kosovo','383'],['KW','Kuwait','965'],['KG','Kyrgyzstan','996'],['LA','Laos','856'],['LV','Latvia','371'],['LB','Lebanon','961'],['LS','Lesotho','266'],['LR','Liberia','231'],['LY','Libya','218'],['LI','Liechtenstein','423'],['LT','Lithuania','370'],['LU','Luxembourg','352'],
  ['MO','Macao','853'],['MG','Madagascar','261'],['MW','Malawi','265'],['MY','Malaysia','60'],['MV','Maldives','960'],['ML','Mali','223'],['MT','Malta','356'],['MH','Marshall Islands','692'],['MQ','Martinique','596'],['MR','Mauritania','222'],['MU','Mauritius','230'],['YT','Mayotte','262'],['MX','Mexico','52'],['FM','Micronesia','691'],['MD','Moldova','373'],['MC','Monaco','377'],['MN','Mongolia','976'],['ME','Montenegro','382'],['MS','Montserrat','1664'],['MA','Morocco','212'],['MZ','Mozambique','258'],['MM','Myanmar','95'],
  ['NA','Namibia','264'],['NR','Nauru','674'],['NP','Nepal','977'],['NL','Netherlands','31'],['NC','New Caledonia','687'],['NZ','New Zealand','64'],['NI','Nicaragua','505'],['NE','Niger','227'],['NG','Nigeria','234'],['NU','Niue','683'],['NF','Norfolk Island','672'],['KP','North Korea','850'],['MK','North Macedonia','389'],['MP','Northern Mariana Islands','1670'],['NO','Norway','47'],['OM','Oman','968'],
  ['PK','Pakistan','92'],['PW','Palau','680'],['PS','Palestine','970'],['PA','Panama','507'],['PG','Papua New Guinea','675'],['PY','Paraguay','595'],['PE','Peru','51'],['PH','Philippines','63'],['PL','Poland','48'],['PT','Portugal','351'],['PR','Puerto Rico','1787'],['QA','Qatar','974'],['RE','Réunion','262'],['RO','Romania','40'],['RU','Russia','7'],['RW','Rwanda','250'],
  ['BL','Saint Barthélemy','590'],['SH','Saint Helena','290'],['KN','Saint Kitts and Nevis','1869'],['LC','Saint Lucia','1758'],['MF','Saint Martin','590'],['PM','Saint Pierre and Miquelon','508'],['VC','Saint Vincent and the Grenadines','1784'],['WS','Samoa','685'],['SM','San Marino','378'],['ST','São Tomé and Príncipe','239'],['SA','Saudi Arabia','966'],['SN','Senegal','221'],['RS','Serbia','381'],['SC','Seychelles','248'],['SL','Sierra Leone','232'],['SG','Singapore','65'],['SX','Sint Maarten','1721'],['SK','Slovakia','421'],['SI','Slovenia','386'],['SB','Solomon Islands','677'],['SO','Somalia','252'],['ZA','South Africa','27'],['GS','South Georgia and the South Sandwich Islands','500'],['KR','South Korea','82'],['SS','South Sudan','211'],['ES','Spain','34'],['LK','Sri Lanka','94'],['SD','Sudan','249'],['SR','Suriname','597'],['SJ','Svalbard and Jan Mayen','47'],['SE','Sweden','46'],['CH','Switzerland','41'],['SY','Syria','963'],
  ['TW','Taiwan','886'],['TJ','Tajikistan','992'],['TZ','Tanzania','255'],['TH','Thailand','66'],['TL','Timor-Leste','670'],['TG','Togo','228'],['TK','Tokelau','690'],['TO','Tonga','676'],['TT','Trinidad and Tobago','1868'],['TN','Tunisia','216'],['TR','Türkiye','90'],['TM','Turkmenistan','993'],['TC','Turks and Caicos Islands','1649'],['TV','Tuvalu','688'],['VI','U.S. Virgin Islands','1340'],['UG','Uganda','256'],['UA','Ukraine','380'],['AE','United Arab Emirates','971'],['GB','United Kingdom','44'],['US','United States','1'],['UY','Uruguay','598'],['UZ','Uzbekistan','998'],['VU','Vanuatu','678'],['VA','Vatican City','39'],['VE','Venezuela','58'],['VN','Vietnam','84'],['WF','Wallis and Futuna','681'],['EH','Western Sahara','212'],['YE','Yemen','967'],['ZM','Zambia','260'],['ZW','Zimbabwe','263'],
].map(([iso, name, code]) => ({ iso, name, code }));

const countryByIso = (iso: string) => countries.find((country) => country.iso === iso) ?? countries.find((country) => country.iso === 'GH')!;

function parseInternational(value: string) {
  const normalized = value.trim().replace(/^00/, '+');
  if (!normalized.startsWith('+')) return null;
  const digits = normalized.slice(1).replace(/\D/g, '');
  const sharedDefaults: Record<string, string> = { '1': 'US', '7': 'RU', '44': 'GB', '61': 'AU', '358': 'FI', '47': 'NO', '590': 'GP', '262': 'RE', '599': 'CW' };
  const match = countries.filter((country) => digits.startsWith(country.code)).sort((a, b) =>
    b.code.length - a.code.length
    || Number(sharedDefaults[b.code] === b.iso) - Number(sharedDefaults[a.code] === a.iso))[0];
  return match ? { country: match, national: digits.slice(match.code.length) } : null;
}

function nationalFor(value: string, country: Country) {
  const compact = value.trim().replace(/[\s().-]/g, '');
  const plusPrefix = `+${country.code}`;
  const zeroPrefix = `00${country.code}`;
  if (compact.startsWith(plusPrefix)) return compact.slice(plusPrefix.length);
  if (compact.startsWith(zeroPrefix)) return compact.slice(zeroPrefix.length);
  return value;
}

function compose(country: Country, national: string) {
  const clean = national.trim();
  if (!clean || clean.startsWith('+') || clean.startsWith('00')) return clean;
  if (country.iso === 'GH') return /^0[235]\d{8}$/.test(clean) ? clean : `+${country.code}${clean}`;
  return `+${country.code}${clean}`;
}

export function PhoneInput({ label, value, onChange, required = false, testId }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  testId: string;
}) {
  const [countryIso, setCountryIso] = useState(() => parseInternational(value)?.country.iso ?? 'GH');
  const country = countryByIso(countryIso);
  useEffect(() => {
    const parsed = parseInternational(value);
    // Shared calling codes cannot identify a country uniquely. Keep an explicit
    // selection (e.g. UK instead of Guernsey, or US instead of Canada).
    if (parsed && parsed.country.code !== country.code) setCountryIso(parsed.country.iso);
  }, [value, countryIso]);
  const displayedNumber = nationalFor(value, country);

  return <div className="block min-w-0">
    <label className="text-sm font-bold" htmlFor={`${testId}-number`}>{label}</label>
    <div className="mt-2 grid grid-cols-[minmax(138px,.8fr)_minmax(0,1fr)] gap-2">
      <label className="sr-only" htmlFor={`${testId}-country`}>{label} country calling code</label>
      <select id={`${testId}-country`} value={country.iso} onChange={(event) => {
        const next = countryByIso(event.target.value);
        setCountryIso(next.iso);
        onChange(compose(next, nationalFor(value, country)));
      }} className="h-12 min-w-0 rounded-xl border border-input bg-card px-2 text-xs text-foreground sm:px-3 sm:text-sm" data-testid={`${testId}-country`}>
        {countries.map((option) => <option key={option.iso} value={option.iso}>{option.name} +{option.code}</option>)}
      </select>
      <input id={`${testId}-number`} type="tel" inputMode="tel" autoComplete="tel-national" value={displayedNumber} onChange={(event) => onChange(compose(country, event.target.value))} required={required} placeholder={country.iso === 'GH' ? '024 123 4567' : 'National number'} className="h-12 min-w-0 rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus:border-primary sm:px-4" data-testid={testId} />
    </div>
  </div>;
}
