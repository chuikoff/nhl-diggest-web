window.NHL_MOCK = {
  games: [
    { id: 1, time: 'Завершён', status: 'Final', away: { name: 'Pittsburgh', nick: 'Penguins', short: 'PIT', logo: 'assets/logos/pit.svg', score: 4 }, home: { name: 'New York Rangers', nick: 'Rangers', short: 'NYR', logo: 'assets/logos/nyr.svg', score: 2 }, period: '3rd' },
    { id: 2, time: 'Завершён', status: 'Final', away: { name: 'Toronto', nick: 'Maple Leafs', short: 'TOR', logo: 'assets/logos/tor.svg', score: 3 }, home: { name: 'Montreal', nick: 'Canadiens', short: 'MTL', logo: 'assets/logos/mtl.svg', score: 3 }, period: 'OT' },
    { id: 3, time: 'LIVE • 2nd', status: 'Live', away: { name: 'Edmonton', nick: 'Oilers', short: 'EDM', logo: 'assets/logos/edm.svg', score: 2 }, home: { name: 'Vancouver', nick: 'Canucks', short: 'VAN', logo: 'assets/logos/van.svg', score: 1 }, period: '08:42' },
    { id: 4, time: 'Завершён', status: 'Final', away: { name: 'Boston', nick: 'Bruins', short: 'BOS', logo: 'assets/logos/bos.svg', score: 1 }, home: { name: 'Washington', nick: 'Capitals', short: 'WSH', logo: 'assets/logos/wsh.svg', score: 5 }, period: '3rd' },
    { id: 5, time: 'Завтра, 02:00', status: 'FUT', away: { name: 'Seattle', nick: 'Kraken', short: 'SEA', logo: 'assets/logos/sea.svg', score: null }, home: { name: 'Calgary', nick: 'Flames', short: 'CGY', logo: 'assets/logos/cgy.svg', score: null }, period: '' },
    { id: 6, time: 'Завтра, 05:30', status: 'Preseason', away: { name: 'Los Angeles', nick: 'Kings', short: 'LAK', logo: 'assets/logos/lak.svg', score: null }, home: { name: 'San Jose', nick: 'Sharks', short: 'SJS', logo: 'assets/logos/sjs.svg', score: null }, period: '' }
  ],
  standings: {
    division: [
      { title: 'Atlantic Division', code: 'EAST', teams: [['Florida Panthers','FLA','6'],['Toronto Maple Leafs','TOR','5'],['Boston Bruins','BOS','4'],['Tampa Bay Lightning','TBL','4']] },
      { title: 'Metropolitan Division', code: 'EAST', teams: [['Carolina Hurricanes','CAR','6'],['New Jersey Devils','NJD','5'],['New York Rangers','NYR','4'],['Pittsburgh Penguins','PIT','3']] }
    ],
    conference: [
      { title: 'Eastern Conference', code: 'EAST', teams: [['Florida Panthers','FLA','6'],['Carolina Hurricanes','CAR','6'],['Toronto Maple Leafs','TOR','5'],['New Jersey Devils','NJD','5']] },
      { title: 'Western Conference', code: 'WEST', teams: [['Edmonton Oilers','EDM','7'],['Colorado Avalanche','COL','6'],['Dallas Stars','DAL','5'],['Vancouver Canucks','VAN','4']] }
    ]
  },
  stats: {
    scorers: [['Connor McDavid','Edmonton Oilers','C','18'],['Nathan MacKinnon','Colorado Avalanche','C','17'],['Leon Draisaitl','Edmonton Oilers','C','16'],['David Pastrnak','Boston Bruins','RW','15']],
    rookies: [['Macklin Celebrini','San Jose Sharks','C','11'],['Matvei Michkov','Philadelphia Flyers','RW','9'],['Lane Hutson','Montreal Canadiens','D','8'],['Logan Stankoven','Dallas Stars','C','7']]
  }
};
