
# Scenarios Requiring Changes to Protocol

## Scenario Categories
- security / bugs
- fee paradigm additions
- adding images for NFT mints + other product enhancements
- adding new capabilities
- multisig and governance needs


## Per Contract Basis

### AssetWrapper.sol
- Creates/mints bundle NFT: add potential for NFT associated image.
- Would it be interesting to somehow also hold images for the NFT's in the bundle?
- Might it potentially need to be upgradable to incorporate a different type of permit (other than ERC721Permit)?
- Bug mitigation.

### FeeController.sol
- Adding varieties of fee and fee structures for more diverse utility such as rollovers.

### LoanCore.sol
- Potential changes for security + bug mitigation.
- Potential changes to "Pausable" caused by shifting governance requirements.
- If new FeeController paradigms are created, adding getters and setters for these.
- Potentially adding supplemental modifiers to the claim function.
- Might it be useful to add the option, for a REPAYER, to be able to use a proxy to pay a loan on their behalf?

### PromissoryNote.sol
- PromissoryNote NFT: add potential for NFT associated image.



