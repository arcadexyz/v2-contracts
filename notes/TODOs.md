## TODOs

Evan:
- Write installments tests
  - (PARTIAL) Update LoanTerms struct.
    - Change from `collateralTokenId` to `bundleId`.
  - Implement interest rate functionality into RepaymentController.sol.
    - (DONE) Change comments for LoanTerms interest.
    - (DONE) Internal calc function.
    - Fix existing tests.
  - (DONE) Port over (5) RepaymentController functions and (1) LoanCore function.
    - (DONE) Rewrite comments in natspec
  - Port over repayPart function to LoanCore.sol
    - Update other functions to jive with LoanTerms.
  - Two new test scripts `Installments.ts` and `InstallmentsRepay.ts`.
    🔑 For Installment tests, run `npx hardhat test test/Installments.ts` or `npx hardhat test test/InstallmentsRepay.ts`.

- Review Origination PR
  - Functionality has been added, but the LoanTerms seem unfinished.
    - I am going to port over my functions the way they are and possibly have to go back later to make them work with changes in the LoanTerms for the `predicate calldata`, `bundleId`, `vaultAddress`, etc..
  - Would a lender sign a bunch of predicate calldata? which a borrower could accept in the set terms by the lender?

Mouzayan:
- Upgradeability and dependency architecture
    - Decide - which contracts should be upgradeable? What upgradeability pattern should they use?
    - Decide - which dependencies need to get passed in constructors for each contract?
    - Decide - of those dependencies, which should be changeable by an admin? Which should be immutable and/or only changeable by upgrade?
- Review Installments PR and Origination PR

Kevin:
- Write Origination tests
- Review installments PR

Leftover:
- Native rollovers
- Custom errors
- Move compiler to 0.8.11
- Re-do natspec - move to implementation, not interfaces
- Testing with full coverage
