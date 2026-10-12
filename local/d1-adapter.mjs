export function d1Adapter(db) {
  return {
    async batch(statements) {
      db.exec('BEGIN');
      try { const result=statements.map(statement=>statement.runSync());db.exec('COMMIT');return result; }
      catch(error){db.exec('ROLLBACK');throw error;}
    },
    prepare(sql) {
      return {
        bind(...args) {
          const runSync=()=>{const result=db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}}};
          return {
            runSync,
            async first(){return db.prepare(sql).get(...args)},
            async all(){return {results:db.prepare(sql).all(...args)}},
            async run(){return runSync()}
          };
        }
      };
    }
  };
}
