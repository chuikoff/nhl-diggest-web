window.NHL_MOCK = {
  defaultDate: '2026-09-29',
  gamesByDate: {
    '2026-09-29': [
    { id: 1, time: 'Завершён', status: 'Final', away: { name: 'Pittsburgh', nick: 'Penguins', short: 'PIT', logo: './assets/logos/pit.svg', score: 4 }, home: { name: 'New York Rangers', nick: 'Rangers', short: 'NYR', logo: './assets/logos/nyr.svg', score: 2 }, period: '3rd' },
    { id: 2, time: 'Завершён', status: 'Final', away: { name: 'Toronto', nick: 'Maple Leafs', short: 'TOR', logo: './assets/logos/tor.svg', score: 3 }, home: { name: 'Montreal', nick: 'Canadiens', short: 'MTL', logo: './assets/logos/mtl.svg', score: 3 }, period: 'OT' },
    { id: 3, time: 'LIVE • 2nd', status: 'Live', away: { name: 'Edmonton', nick: 'Oilers', short: 'EDM', logo: './assets/logos/edm.svg', score: 2 }, home: { name: 'Vancouver', nick: 'Canucks', short: 'VAN', logo: './assets/logos/van.svg', score: 1 }, period: '08:42' },
    { id: 4, time: 'Завершён', status: 'Final', away: { name: 'Boston', nick: 'Bruins', short: 'BOS', logo: './assets/logos/bos.svg', score: 1 }, home: { name: 'Washington', nick: 'Capitals', short: 'WSH', logo: './assets/logos/wsh.svg', score: 5 }, period: '3rd' },
    { id: 5, time: '02:00', status: 'FUT', away: { name: 'Seattle', nick: 'Kraken', short: 'SEA', logo: './assets/logos/sea.svg', score: null }, home: { name: 'Calgary', nick: 'Flames', short: 'CGY', logo: './assets/logos/cgy.svg', score: null }, period: '' },
    { id: 6, time: '05:30', status: 'Preseason', away: { name: 'Los Angeles', nick: 'Kings', short: 'LAK', logo: './assets/logos/lak.svg', score: null }, home: { name: 'San Jose', nick: 'Sharks', short: 'SJS', logo: './assets/logos/sjs.svg', score: null }, period: '' }
    ],
    '2026-09-28': [
      { id: 7, time: 'Завершён', status: 'Final', away: { name: 'New York Rangers', nick: 'Rangers', short: 'NYR', logo: './assets/logos/nyr.svg', score: 2 }, home: { name: 'Boston', nick: 'Bruins', short: 'BOS', logo: './assets/logos/bos.svg', score: 4 }, period: '3rd' },
      { id: 8, time: 'Завершён', status: 'Final', away: { name: 'Montreal', nick: 'Canadiens', short: 'MTL', logo: './assets/logos/mtl.svg', score: 2 }, home: { name: 'Toronto', nick: 'Maple Leafs', short: 'TOR', logo: './assets/logos/tor.svg', score: 5 }, period: '3rd' },
      { id: 9, time: '01:00', status: 'FUT', away: { name: 'Edmonton', nick: 'Oilers', short: 'EDM', logo: './assets/logos/edm.svg', score: null }, home: { name: 'Calgary', nick: 'Flames', short: 'CGY', logo: './assets/logos/cgy.svg', score: null }, period: '' }
    ],
    '2026-09-30': [
      { id: 10, time: '01:30', status: 'FUT', away: { name: 'Washington', nick: 'Capitals', short: 'WSH', logo: './assets/logos/wsh.svg', score: null }, home: { name: 'Pittsburgh', nick: 'Penguins', short: 'PIT', logo: './assets/logos/pit.svg', score: null }, period: '' },
      { id: 11, time: '04:00', status: 'FUT', away: { name: 'Seattle', nick: 'Kraken', short: 'SEA', logo: './assets/logos/sea.svg', score: null }, home: { name: 'Vancouver', nick: 'Canucks', short: 'VAN', logo: './assets/logos/van.svg', score: null }, period: '' },
      { id: 12, time: '05:30', status: 'Preseason', away: { name: 'Los Angeles', nick: 'Kings', short: 'LAK', logo: './assets/logos/lak.svg', score: null }, home: { name: 'San Jose', nick: 'Sharks', short: 'SJS', logo: './assets/logos/sjs.svg', score: null }, period: '' }
    ]
  },
  // Team tuple: [name, abbreviation, wins, losses, overtime losses, points].
  // The values are preseason/demo placeholders, but cover every NHL club.
  standings: {
    division: [
      { title: 'Atlantic Division', code: 'EAST', teams: [
        ['Florida Panthers', 'FLA', 52, 23, 7, 111], ['Toronto Maple Leafs', 'TOR', 49, 25, 8, 106],
        ['Tampa Bay Lightning', 'TBL', 46, 28, 8, 100], ['Boston Bruins', 'BOS', 45, 29, 8, 98],
        ['Ottawa Senators', 'OTT', 39, 33, 10, 88], ['Detroit Red Wings', 'DET', 38, 35, 9, 85],
        ['Buffalo Sabres', 'BUF', 35, 38, 9, 79], ['Montreal Canadiens', 'MTL', 32, 41, 9, 73]
      ] },
      { title: 'Metropolitan Division', code: 'EAST', teams: [
        ['Carolina Hurricanes', 'CAR', 51, 24, 7, 109], ['New Jersey Devils', 'NJD', 48, 27, 7, 103],
        ['New York Rangers', 'NYR', 46, 28, 8, 100], ['New York Islanders', 'NYI', 41, 33, 8, 90],
        ['Pittsburgh Penguins', 'PIT', 39, 34, 9, 87], ['Washington Capitals', 'WSH', 38, 35, 9, 85],
        ['Columbus Blue Jackets', 'CBJ', 33, 40, 9, 75], ['Philadelphia Flyers', 'PHI', 31, 42, 9, 71]
      ] },
      { title: 'Central Division', code: 'WEST', teams: [
        ['Winnipeg Jets', 'WPG', 53, 22, 7, 113], ['Dallas Stars', 'DAL', 50, 24, 8, 108],
        ['Colorado Avalanche', 'COL', 48, 27, 7, 103], ['Nashville Predators', 'NSH', 43, 31, 8, 94],
        ['Minnesota Wild', 'MIN', 42, 32, 8, 92], ['St. Louis Blues', 'STL', 39, 35, 8, 86],
        ['Utah Mammoth', 'UTA', 34, 40, 8, 76], ['Chicago Blackhawks', 'CHI', 28, 46, 8, 64]
      ] },
      { title: 'Pacific Division', code: 'WEST', teams: [
        ['Vegas Golden Knights', 'VGK', 50, 25, 7, 107], ['Edmonton Oilers', 'EDM', 49, 26, 7, 105],
        ['Vancouver Canucks', 'VAN', 45, 30, 7, 97], ['Los Angeles Kings', 'LAK', 44, 31, 7, 95],
        ['Calgary Flames', 'CGY', 38, 36, 8, 84], ['Seattle Kraken', 'SEA', 36, 37, 9, 81],
        ['Anaheim Ducks', 'ANA', 30, 44, 8, 68], ['San Jose Sharks', 'SJS', 24, 50, 8, 56]
      ] }
    ],
    conference: [
      { title: 'Eastern Conference', code: 'EAST', teams: [
        ['Florida Panthers', 'FLA', 52, 23, 7, 111], ['Carolina Hurricanes', 'CAR', 51, 24, 7, 109],
        ['Toronto Maple Leafs', 'TOR', 49, 25, 8, 106], ['New Jersey Devils', 'NJD', 48, 27, 7, 103],
        ['Tampa Bay Lightning', 'TBL', 46, 28, 8, 100], ['New York Rangers', 'NYR', 46, 28, 8, 100],
        ['Boston Bruins', 'BOS', 45, 29, 8, 98], ['New York Islanders', 'NYI', 41, 33, 8, 90],
        ['Ottawa Senators', 'OTT', 39, 33, 10, 88], ['Pittsburgh Penguins', 'PIT', 39, 34, 9, 87],
        ['Detroit Red Wings', 'DET', 38, 35, 9, 85], ['Washington Capitals', 'WSH', 38, 35, 9, 85],
        ['Buffalo Sabres', 'BUF', 35, 38, 9, 79], ['Columbus Blue Jackets', 'CBJ', 33, 40, 9, 75],
        ['Montreal Canadiens', 'MTL', 32, 41, 9, 73], ['Philadelphia Flyers', 'PHI', 31, 42, 9, 71]
      ] },
      { title: 'Western Conference', code: 'WEST', teams: [
        ['Winnipeg Jets', 'WPG', 53, 22, 7, 113], ['Dallas Stars', 'DAL', 50, 24, 8, 108],
        ['Vegas Golden Knights', 'VGK', 50, 25, 7, 107], ['Edmonton Oilers', 'EDM', 49, 26, 7, 105],
        ['Colorado Avalanche', 'COL', 48, 27, 7, 103], ['Vancouver Canucks', 'VAN', 45, 30, 7, 97],
        ['Los Angeles Kings', 'LAK', 44, 31, 7, 95], ['Nashville Predators', 'NSH', 43, 31, 8, 94],
        ['Minnesota Wild', 'MIN', 42, 32, 8, 92], ['St. Louis Blues', 'STL', 39, 35, 8, 86],
        ['Calgary Flames', 'CGY', 38, 36, 8, 84], ['Seattle Kraken', 'SEA', 36, 37, 9, 81],
        ['Utah Mammoth', 'UTA', 34, 40, 8, 76], ['Anaheim Ducks', 'ANA', 30, 44, 8, 68],
        ['Chicago Blackhawks', 'CHI', 28, 46, 8, 64], ['San Jose Sharks', 'SJS', 24, 50, 8, 56]
      ] }
    ]
  },
  stats: {
    scorers: [
      { name: 'Connor McDavid', team: 'Edmonton Oilers', position: 'C', goals: 8, assists: 10, points: 18 },
      { name: 'Nathan MacKinnon', team: 'Colorado Avalanche', position: 'C', goals: 7, assists: 10, points: 17 },
      { name: 'Leon Draisaitl', team: 'Edmonton Oilers', position: 'C', goals: 9, assists: 7, points: 16 },
      { name: 'David Pastrnak', team: 'Boston Bruins', position: 'RW', goals: 8, assists: 7, points: 15 }
    ],
    rookies: [
      { name: 'Macklin Celebrini', team: 'San Jose Sharks', position: 'C', goals: 5, assists: 6, points: 11 },
      { name: 'Matvei Michkov', team: 'Philadelphia Flyers', position: 'RW', goals: 4, assists: 5, points: 9 },
      { name: 'Lane Hutson', team: 'Montreal Canadiens', position: 'D', goals: 2, assists: 6, points: 8 },
      { name: 'Logan Stankoven', team: 'Dallas Stars', position: 'C', goals: 3, assists: 4, points: 7 }
    ],
    goalies: [
      { name: 'Connor Hellebuyck', team: 'Winnipeg Jets', position: 'G', wins: 12, gaa: '2.11', sv: '.924' },
      { name: 'Igor Shesterkin', team: 'New York Rangers', position: 'G', wins: 11, gaa: '2.24', sv: '.921' },
      { name: 'Stuart Skinner', team: 'Edmonton Oilers', position: 'G', wins: 10, gaa: '2.35', sv: '.918' },
      { name: 'Jeremy Swayman', team: 'Boston Bruins', position: 'G', wins: 9, gaa: '2.42', sv: '.915' }
    ]
  },
  // Detailed game data is keyed by the same id as games above.
  gameDetails: {
    1: {
      venue: 'PPG Paints Arena', attendance: '18 006',
      scoring: [
        { period: '1st', time: '04:18', team: 'PIT', scorer: 'Jake Guentzel', assists: ['Sidney Crosby', 'Erik Karlsson'] },
        { period: '1st', time: '12:44', team: 'NYR', scorer: 'Artemi Panarin', assists: ['Vincent Trocheck', 'Adam Fox'] },
        { period: '2nd', time: '06:02', team: 'PIT', scorer: 'Bryan Rust', assists: ['Evgeni Malkin'] },
        { period: '2nd', time: '15:36', team: 'NYR', scorer: 'Chris Kreider', assists: ['Mika Zibanejad'] },
        { period: '3rd', time: '03:17', team: 'PIT', scorer: 'Sidney Crosby', assists: ['Bryan Rust', 'Marcus Pettersson'] },
        { period: '3rd', time: '18:51', team: 'PIT', scorer: 'Rickard Rakell', assists: ['Erik Karlsson'] }
      ],
      penalties: [
        { period: '2nd', time: '11:02', team: 'NYR', player: 'Jacob Trouba', minutes: 2, infraction: 'Tripping' },
        { period: '3rd', time: '09:14', team: 'PIT', player: 'Marcus Pettersson', minutes: 2, infraction: 'Holding' }
      ],
      boxscore: { PIT: { shots: 32, hits: 21, faceoff: '52%', powerPlay: '1/4' }, NYR: { shots: 30, hits: 18, faceoff: '48%', powerPlay: '0/3' } },
      goalies: [
        { team: 'PIT', name: 'Tristan Jarry', number: '35', saves: '28/30', goalsAgainst: 2, sv: '.933', toi: '60:00', decision: 'W' },
        { team: 'NYR', name: 'Igor Shesterkin', number: '31', saves: '28/32', goalsAgainst: 4, sv: '.875', toi: '60:00', decision: 'L' }
      ],
      skaters: [
        { team: 'PIT', number: '87', name: 'Sidney Crosby', goals: 1, assists: 1, points: 2, plusMinus: 2, sog: 4, pim: 0, hits: 1, blocks: 0, faceoffPct: '58%', toi: '21:04' },
        { team: 'PIT', number: '59', name: 'Jake Guentzel', goals: 1, assists: 0, points: 1, plusMinus: 1, sog: 5, pim: 0, hits: 2, blocks: 1, faceoffPct: '0%', toi: '18:42' },
        { team: 'PIT', number: '17', name: 'Bryan Rust', goals: 1, assists: 1, points: 2, plusMinus: 2, sog: 3, pim: 0, hits: 3, blocks: 0, faceoffPct: '', toi: '17:11' },
        { team: 'PIT', number: '58', name: 'Kris Letang', goals: 0, assists: 1, points: 1, plusMinus: 1, sog: 2, pim: 2, hits: 1, blocks: 3, faceoffPct: '', toi: '23:18' },
        { team: 'NYR', number: '10', name: 'Artemi Panarin', goals: 1, assists: 0, points: 1, plusMinus: -1, sog: 4, pim: 0, hits: 0, blocks: 0, faceoffPct: '', toi: '20:33' },
        { team: 'NYR', number: '20', name: 'Chris Kreider', goals: 1, assists: 0, points: 1, plusMinus: 0, sog: 3, pim: 0, hits: 4, blocks: 1, faceoffPct: '', toi: '16:50' },
        { team: 'NYR', number: '93', name: 'Mika Zibanejad', goals: 0, assists: 1, points: 1, plusMinus: -1, sog: 2, pim: 0, hits: 1, blocks: 0, faceoffPct: '51%', toi: '19:22' },
        { team: 'NYR', number: '23', name: 'Adam Fox', goals: 0, assists: 1, points: 1, plusMinus: -2, sog: 1, pim: 0, hits: 0, blocks: 2, faceoffPct: '', toi: '24:05' }
      ]
    },
    2: {
      venue: 'Bell Centre', attendance: '21 105',
      scoring: [
        { period: '1st', time: '02:51', team: 'TOR', scorer: 'Auston Matthews', assists: ['William Nylander', 'Morgan Rielly'] },
        { period: '1st', time: '14:06', team: 'MTL', scorer: 'Nick Suzuki', assists: ['Cole Caufield'] },
        { period: '2nd', time: '07:29', team: 'TOR', scorer: 'Mitch Marner', assists: ['John Tavares'] },
        { period: '2nd', time: '19:41', team: 'MTL', scorer: 'Juraj Slafkovsky', assists: ['Kirby Dach', 'Mike Matheson'] },
        { period: '3rd', time: '08:17', team: 'TOR', scorer: 'Matthew Knies', assists: ['Max Domi'] },
        { period: '3rd', time: '16:58', team: 'MTL', scorer: 'Brendan Gallagher', assists: ['Alex Newhook'] }
      ],
      penalties: [
        { period: '1st', time: '09:12', team: 'TOR', player: 'Simon Benoit', minutes: 2, infraction: 'Interference' },
        { period: '3rd', time: '04:37', team: 'MTL', player: 'Mike Matheson', minutes: 2, infraction: 'Hooking' }
      ],
      boxscore: { TOR: { shots: 35, hits: 16, faceoff: '51%', powerPlay: '0/2' }, MTL: { shots: 29, hits: 24, faceoff: '49%', powerPlay: '0/3' } },
      goalies: [
        { team: 'TOR', name: 'Joseph Woll', saves: '26/29', gaa: '3.00' },
        { team: 'MTL', name: 'Samuel Montembeault', saves: '32/35', gaa: '3.00' }
      ]
    },
    3: {
      venue: 'Rogers Arena', attendance: '18 870',
      scoring: [
        { period: '1st', time: '05:22', team: 'EDM', scorer: 'Leon Draisaitl', assists: ['Connor McDavid', 'Evan Bouchard'] },
        { period: '1st', time: '17:40', team: 'VAN', scorer: 'Elias Pettersson', assists: ['Quinn Hughes'] },
        { period: '2nd', time: '03:18', team: 'EDM', scorer: 'Zach Hyman', assists: ['Ryan Nugent-Hopkins'] }
      ],
      penalties: [
        { period: '2nd', time: '06:03', team: 'VAN', player: 'Filip Hronek', minutes: 2, infraction: 'Slashing' }
      ],
      boxscore: { EDM: { shots: 19, hits: 12, faceoff: '54%', powerPlay: '0/1' }, VAN: { shots: 16, hits: 15, faceoff: '46%', powerPlay: '0/2' } },
      goalies: [
        { team: 'EDM', name: 'Stuart Skinner', saves: '15/16', gaa: '1.00' },
        { team: 'VAN', name: 'Thatcher Demko', saves: '17/19', gaa: '2.00' }
      ]
    },
    4: {
      venue: 'Capital One Arena', attendance: '18 573',
      scoring: [
        { period: '1st', time: '03:44', team: 'WSH', scorer: 'Alex Ovechkin', assists: ['Dylan Strome', 'John Carlson'] },
        { period: '1st', time: '11:20', team: 'BOS', scorer: 'David Pastrnak', assists: ['Brad Marchand'] },
        { period: '2nd', time: '05:10', team: 'WSH', scorer: 'Tom Wilson', assists: ['Martin Fehervary'] },
        { period: '2nd', time: '13:32', team: 'WSH', scorer: 'Connor McMichael', assists: ['Jakob Chychrun'] },
        { period: '3rd', time: '02:17', team: 'WSH', scorer: 'Dylan Strome', assists: ['Alex Ovechkin'] },
        { period: '3rd', time: '16:05', team: 'WSH', scorer: 'Aliaksei Protas', assists: ['Rasmus Sandin'] }
      ],
      penalties: [
        { period: '1st', time: '08:45', team: 'BOS', player: 'Charlie McAvoy', minutes: 2, infraction: 'Hooking' },
        { period: '2nd', time: '10:11', team: 'WSH', player: 'Nic Dowd', minutes: 2, infraction: 'Holding' }
      ],
      boxscore: { BOS: { shots: 27, hits: 20, faceoff: '47%', powerPlay: '0/3' }, WSH: { shots: 34, hits: 22, faceoff: '53%', powerPlay: '1/3' } },
      goalies: [
        { team: 'BOS', name: 'Jeremy Swayman', saves: '29/34', gaa: '5.00' },
        { team: 'WSH', name: 'Charlie Lindgren', saves: '26/27', gaa: '1.00' }
      ]
    },
    5: { venue: 'Climate Pledge Arena', scheduled: true },
    6: { venue: 'Crypto.com Arena', scheduled: true }
  }
};
window.NHL_MOCK.games = window.NHL_MOCK.gamesByDate[window.NHL_MOCK.defaultDate];
